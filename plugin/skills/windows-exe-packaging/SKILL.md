---
name: windows-exe-packaging
description: 将 Node.js CLI/插件打包为 Windows 可执行文件（SEA 单文件 + WebView2 壳 + Inno Setup 安装器 + 图标）。当用户要求"打包成 exe"、"做 Windows 安装包"、"SEA 打包"、"WebView2 壳"、"Inno Setup"、"生成安装器"、"图标"时使用。与 dsh-plugin-creation（插件逻辑）、github-release-publish（发布）互补。
---

# Windows EXE 打包（SEA + WebView2 + Inno Setup）

> **权威文档**：`docs/RELEASE-PLAYBOOK.md §3`（CLI SOP）、`§3.5`（GUI SOP）、`docs/PROCESS-REVIEW.md §7`（错误清单）
> **关键脚本**：`scripts/build-sea.ps1`、`scripts/build-installer.ps1`、`scripts/make-icon.ps1`

## 零、架构速记

```
SEA 引擎（Node.js 单文件可执行）
  └─ scripts/build-sea.ps1: esbuild bundle → SEA blob → postject 注入 → dist/disk-clean-win-x64.exe

GUI 壳（可选，WebView2 原生窗口）
  ├─ gui/shell/DiskCleanUi.csproj  (.NET 8 框架依赖, PublishSingleFile)
  ├─ gui/shell/Program.cs          (提权+spawn引擎+日志)
  ├─ gui/shell/MainForm.cs         (WebView2+token注入+进程树清理)
  └─ gui/web/                      (零依赖前端, 静态托管)

安装器（Inno Setup）
  ├─ installer/disk-clean-ui.iss   (检测运行时+下载引导+LZMA2压缩)
  └─ gui/dist/disk-clean-setup-<ver>.exe

图标（三处接入）
  └─ scripts/make-icon.ps1 → gui/shell/app.ico + gui/web/favicon.svg
```

## 一、SEA 打包（CLI → 单文件 exe）

### 构建链

```
scripts/build-sea.ps1
  1) esbuild bundle (bin/disk-clean.js + lib/*) → sea-bundle.js
  2) node --experimental-sea-config sea-config.json → sea-prep.blob
  3) postject 注入 blob → dist/disk-clean-win-x64.exe
  4) 生成 dist/checksums.txt + exe.sha256
```

### 铁律

- **脚本全 ASCII**（CI pwsh7 下中文破坏字符串）
- **子进程自我调用**按 `IS_SEA` 分派：`--internal-*` 位置参数（非 flag）
- **零运行时依赖**（Node 内建 + PowerShell 补齐）
- `package.json` 的 `version` 是 `checksums.txt` 的 version 来源

### 版本四源（bump 时一处不漏）

```
bin/disk-clean.js VER  +  lib/serve.js VER  +  DiskCleanUi.csproj Version  +  package.json version
```

## 二、WebView2 壳（C# WinForms）

### 三进程模型

```
disk-clean-ui.exe (UAC 提权, ~24MB)
  ├─ TcpListener(IPAddress.Loopback, 0) → 空闲端口 + Guid token
  ├─ spawn engine.exe serve --port <p> --token <t> --web <dir>  ← 位置参数 serve！
  ├─ 轮询 /api/health (30s 超时/300ms 间隔)
  └─ WebView2 Navigate http://127.0.0.1:<port>/ (关闭→KillEngine进程树)
```

### 壳零业务逻辑

C# 只做三件事：提权 + 拉起引擎 + 托管 WebView2。8 个工具全部复用 `lib/serve.js`。

### C# 高频坑

| 坑 | 修复 |
|---|---|
| Nullable disable 下 `?` 注解 | 不写 `?`（CS8632），`GetArg` 返回 `string.Empty` |
| `GetArg` 空串 `??` 无效 | 用 `IsNullOrEmpty` |
| 引擎 stdout 中文乱码 | `StandardOutputEncoding = UTF8`，日志 UTF-8，PS 读 `-Encoding UTF8` |
| `ProcessStartInfo` 无 `ArgumentList` (PS5.1) | 用 `Arguments` 字符串，路径加 `\"` |
| WebView2 环境 | `CreateAsync(userDataFolder=%LOCALAPPDATA%\disk-clean\webview2)` → `EnsureCoreWebView2Async` → `AddScriptToExecuteOnDocumentCreated` 注入 token |

## 三、安装器（Inno Setup）

### 构建链（顺序铁律）

```
scripts/build-installer.ps1
  0) scripts/make-icon.ps1        ← 图标先行
  1) dotnet publish gui/shell → gui/stage
  2) scripts/build-sea.ps1        ← 引擎
  3) Copy dist/exe → gui/stage/engine.exe + web → gui/stage/web
  4) ISCC installer/disk-clean-ui.iss → gui/dist/setup-<ver>.exe
  5) sha256 → .sha256
```

### 框架依赖 + 缺则引导

- **体积优先**：框架依赖（非自包含），缺时 `DownloadTemporaryFile` 拉官方 bootstrapper 静默安装
- **检测用文件夹探测**（`FindFirst('...\8.0.*')`）比注册表可靠

### PascalScript 铁律

- 函数**先声明后使用**（无前向引用）
- `DownloadTemporaryFile` 实签 4 参：`(Url, BaseName, RequiredSHA256OfFile, OnDownloadProgress): Int64`，失败 -1；**BaseName 只传裸文件名**
- `FindFirst/FindClose` 用 `TFindRec`
- 运行时检测：`DirExists + FindFirst('8.0.*')`
- 中文向导 `ChineseSimplified.isl` 官方不带→向导英文，程序内双语不受影响

### 正式安装铁律（G44/G45）

```powershell
# 1. 先清理 E2E 残留（Inno 同 AppId 会沿用旧目录）
Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\{AppId}_is1' | Select InstallLocation
& "C:\Program\unins000.exe" /VERYSILENT /NORESTART  # 如果指向临时目录

# 2. 显式带引号 /DIR（Start-Process 数组会拆空格）
$args = '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /DIR="C:\Program Files\disk-clean" /LOG=C:\temp\install.log'
Start-Process setup.exe -ArgumentList $args -Wait
```

## 四、图标管线

```
scripts/make-icon.ps1 (System.Drawing)
  256 主图（深色圆角+磁盘环+绿闪电）→ 16/24/32/48/64/128/256 PNG → PNG-in-ICO (app.ico)
  + gui/web/favicon.svg
```

三处接入：`csproj ApplicationIcon` + `iss SetupIconFile` + `web favicon.svg`（serve 白名单含 .ico/.svg）

**PS 5.1 脚本铁律**：`New-Object Type(` 跨多行解析失败返回 null→用 `::new()` 单行；脚本全 ASCII 注释（BOM-less UTF-8 中文被 ANSI 错读）

## 五、验证清单

- [ ] `dotnet build gui/shell` 快速失败（不攒到最后）
- [ ] 静默安装 `EXIT=0` → 产物齐全（ui.exe+engine.exe+web\+unins*）
- [ ] 启动即用（引擎 spawn 日志出现 serve 行）
- [ ] 缺运行时引导（卸载 .NET/WebView2 后弹窗下载）
- [ ] GitHub 下载 → Get-FileHash 一致 → 静默安装 → 启动 → 健康 → 页面 200
- [ ] `gui/stage|publish|dist` 全部 gitignore，`dist/SHA256SUMS.txt` 发布时手工组装

## 六、持续优化（执行中发现问题立即更新）

| 发现什么 | 更新哪里 |
|---|---|
| 新坑/失败 | `docs/PROCESS-REVIEW.md §7` + 本技能 §二/三 |
| 构建链变更 | `scripts/build-installer.ps1` + `docs/RELEASE-PLAYBOOK.md §3.5.4` |
| 版本漂移 | 四源 grep 核对 |
| 图标/前端变更 | `gui/web/*` + `scripts/make-icon.ps1` |

> **老规矩**：每次构建/发布后，用 `Get-FileHash` 双向核对本地与 GitHub 资产 digest，再更新文档与技能，三处同步（product/install/repo）。
