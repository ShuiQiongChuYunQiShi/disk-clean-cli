---
name: gui-development
description: 开发/修改 disk-clean 桌面端 GUI（WebView2 原生窗口：C# 壳、引擎 serve 层、零依赖前端、Inno Setup 安装器）。当用户要求修改 GUI 界面、加前端功能、改安装器、构建 GUI 安装包、排查 GUI 启动/渲染/安装问题，或问 GUI 架构/验收点时使用。与 release-sop（发布流程）互补；本技能偏 GUI 专项实现细节。
---

# gui-development —— disk-clean GUI 桌面端开发 SOP（专项技能）

> 适用：windowClear 项目的 GUI 形态（仓库 `gui/` + `installer/` + `lib/serve.js`）。
> **权威文档**（永远以仓库为准，本文件只放速查）：`docs/GUI-PLAN.md`（设计/验收点）、
> `docs/RELEASE-PLAYBOOK.md §3.5`（制作 SOP）、`docs/PROCESS-REVIEW.md §7`（GUI 错误清单）。
> 新会话开头先读上述三份 + 本次任务相关源码，再动工。

## 零、架构速记（先对号入座）

```
disk-clean-ui.exe（C# WinForms+WebView2 壳，.NET 8 框架依赖单 exe ~24MB，UAC 提权）
  ├─ TcpListener(IPAddress.Loopback, 0) → 空闲端口 + Guid token
  ├─ spawn engine.exe serve --port <p> --token <t> --web <dir>   ← 位置参数 serve，不是 --serve！
  ├─ 轮询 /api/health 就绪（30s 超时 / 300ms 间隔）
  └─ WebView2 加载 http://127.0.0.1:<port>/（关闭窗口 → KillEngine 进程树）

lib/serve.js（引擎 HTTP 层，零重写包装 CLI 8 工具）
  ├─ 仅绑 127.0.0.1；除 /api/health 外全要求 Authorization: Bearer <token>
  ├─ /api/scan spawn 子进程 --internal-scan + --progress 文件轮询
  ├─ /api/clean 空 paths 自动提取候选（extractCleanPaths，宁拒勿删）
  └─ 静态托管：STATIC_EXT 白名单 + path.resolve 前缀防穿越

gui/web/（零依赖：index.html + style.css + app.js；主页极简 + 8 高级 Tab，双语 i18n）
  ├─ 盘符卡片：真实容量 statfsSync + 进度条 + 已用/可用；默认只选 D + 记忆 + 全选/清空
  ├─ 扫描前范围确认弹窗（把"将扫 X:、Y:"列给用户）+ 报告回显扫描范围 + 取消按钮
  └─ 高级页：MFT 盘符动态生成、schedule weekly 带 day 下拉、dedup 合并复用 lastScanRoots
installer/disk-clean-ui.iss + scripts/build-installer.ps1（框架依赖 + 缺则引导 bootstrapper）
  ├─ 图标三处接入：csproj ApplicationIcon(app.ico) / iss SetupIconFile / web favicon.svg
  └─ 构建链 step 0 = scripts/make-icon.ps1（System.Drawing → 多尺寸 PNG → PNG-in-ICO）
```

## 一、目录与角色

| 路径 | 角色 | 构建产物 |
|---|---|---|
| `gui/shell/` | C# 壳（DiskCleanUi.csproj / Program.cs / MainForm.cs / app.manifest） | `gui/stage/disk-clean-ui.exe` |
| `lib/serve.js` | 引擎 HTTP 服务层（唯一新写的后端代码） | 打进 SEA 引擎 |
| `gui/web/` | 前端三件套（改 UI 只动这里） | 原样复制到安装器 web\ |
| `installer/` | Inno Setup 脚本 | `gui/dist/disk-clean-setup-<ver>.exe` |
| `scripts/build-installer.ps1` | 全链构建（publish→SEA→组装→ISCC→sha256） | 一键出包 |

## 二、高频坑速查（每题必查，详见 PROCESS-REVIEW §7）

1. **位置参数 vs flag**：spawn 命令行写 `serve --port …` 不是 `--serve …`。
2. **C# Nullable disable**：不写 `?` 注解（CS8632）；`GetArg` 返回 `string.Empty`；
   `??` 对空串无效 → `IsNullOrEmpty`。
3. **C# 引擎重定向**：`StandardOutputEncoding = Encoding.UTF8`；日志文件 UTF-8，
   PowerShell 读日志必须 `-Encoding UTF8`（默认 GBK 读中文乱码，别误判成引擎输出问题）。
4. **PS 5.1 限制**：无 `&&`、无三元 `? :`、`ProcessStartInfo` 无 `ArgumentList`（用 `Arguments` 字符串）。
5. **Inno Setup PascalScript**：
   - 函数必须先声明后使用（无前向引用）；
   - `DownloadTemporaryFile` 实签 4 参 `(Url, BaseName, RequiredSHA256OfFile, OnDownloadProgress): Int64`（失败 -1）；
   - `BaseName` 只传裸文件名（自动落 `{tmp}`，传全路径会 `{tmp}\{tmp}\` 前缀重复）；
   - `FindFirst`/`FindClose` 用 `TFindRec` 结构体；
   - 运行时检测用文件夹探测 `DirExists + FindFirst('8.0.*')` 而非注册表（布局因安装器而异）；
   - 缺 ChineseSimplified.isl → 向导英文（程序内 UI 双语不受影响）。
6. **Edge headless 验证**：必须 `--headless=new --disable-gpu --user-data-dir=<独立临时目录>`，
   旧 `--headless` 模式会空输出；校验 `Uncaught|ReferenceError|TypeError` 为零。
7. **版本四源同步**：`bin/disk-clean.js VER`、`lib/serve.js VER`、`DiskCleanUi.csproj Version/FileVersion`、
   `package.json version`（checksums.txt `version=` 来源）——bump 时一处不漏。
8. **构建顺序铁律**：改 serve.js/web → 重建 SEA（`scripts/build-sea.ps1`）→ `build-installer.ps1`；
   上传 Release 期间**不要重建源文件**（破坏半传文件）；`gui/stage|publish|dist` 全部 gitignore。
9. **盘符容量唯一解 = `fs.statfsSync`**：`/api/drives` 返回 `{total,free,avail,used}`。
   `fs.statSync(root).blocks*512` 是根目录自身块数（显示 24kb 事故根因），严禁再用。
10. **范围型操作三要件**（扫描/去重/整理）：界面默认只选数据盘并 `localStorage` 记忆 +
    操作前范围确认弹窗（列出盘/已用/合计）+ 服务端缺省 roots 只回退最近报告
    `summary.roots`。**禁止默认全选、禁止静默回退全盘**（曾致"以为选 D 实际扫 C+E+F=2.2TB"、
    dedup 硬链接扫 C:\+D:\）。前端 `syncDriveCards()` 保证卡片视觉态与数组一致。
11. **PS 5.1 脚本**：`New-Object Type(` 参数列表**跨多行解析失败返回 null**——构造全部
    单行或 `::new()`；脚本注释保持**全 ASCII**（BOM-less UTF-8 中文被 ANSI 错读）。
12. **PS 调 API 发中文 JSON**：`-Body ([Text.Encoding]::UTF8.GetBytes($json))` +
    `Content-Type: application/json; charset=utf-8`（字符串体 Latin-1 把中文变 `???` 假 400）。
13. **取消与校验**：`POST /api/scan/cancel {job}`；取消测试用临时 report 路径
    （`body.report=$TEMP\x.json`）防覆盖好报告；发布用 `dist/SHA256SUMS.txt` 是**手工组装**
    （build-sea 只写 `dist/checksums.txt` + `exe.sha256`）。

## 三、开发工作流（改前端为例）

1. 改 `gui/web/*` → `node --check gui/web/app.js`（语法）→
   `Copy-Item gui/web/* gui/publish/web/`（若用 publish 目录跑 GUI）。
2. 快速迭代后端：`node bin\disk-clean.js serve --port <p> --token <t> --web gui\web` →
   curl/Invoke-RestMethod 冒烟 API（health/drives/scan/…）。
3. 前端渲染验证：Edge headless（见上方 #6）带 `?token=<t>` 打开，查 DOM 标志与 JS 错误。
4. 改 C# 壳：改完立即 `dotnet build gui\shell\DiskCleanUi.csproj` 快速失败（不攒到最后）。
5. 完整回归：`powershell -ExecutionPolicy Bypass -File scripts\build-installer.ps1` →
   静默安装到测试目录 → 从安装目录启动 GUI → 引擎健康 + 页面 200。
6. 发布判据（不算完成）：GitHub 下载 setup → `Get-FileHash` 与本地一致 →
   静默安装 → 启动 → 健康 → 页面 200。

## 四、验收点（对应 GUI-PLAN.md ①–⑤）

- ① 原生窗口标题"disk-clean — 磁盘清理与分析"、无黑框、引擎 health OK、静态页 200
- ② curl 全 API：无 token 401 / 带 token 200 / scan 全程 / 静态托管 200
- ③ 前端完整渲染：nav/盘符/真实容量数字/默认选中 D + **零 JS 错误**（headless 可查）
- ④ **数据正确性三重断言**（真机全量扫 D 验证）：`roots==所选`、`totalBytes ≤ 卷容量`、
  `categorySum==totalBytes`（0 差）+ 图标三处可见（exe/安装器/favicon）
- ⑤ 安装器：静默安装 EXIT=0、产物齐全、启动即用、缺运行时引导
- ⑥ GitHub 下载 → 校验 → 安装 → 启动全链路（真实用户路径）

## 五、关键文件指针

| 想看什么 | 读哪个 |
|---|---|
| GUI 设计/验收点 | `docs/GUI-PLAN.md` |
| GUI 制作 SOP | `docs/RELEASE-PLAYBOOK.md §3.5` |
| GUI 错误清单 | `docs/PROCESS-REVIEW.md §7`（G1–G43 全表） |
| 壳源码 | `gui/shell/Program.cs`（引擎拉起/日志）、`MainForm.cs`（WebView2/token 注入）、`DiskCleanUi.csproj`（ApplicationIcon） |
| 服务层 | `lib/serve.js`（API 路由/鉴权/扫描 job/statfsSync/取消/提取逻辑） |
| 安装器 | `installer/disk-clean-ui.iss`（检测/下载引导/SetupIconFile）、`scripts/build-installer.ps1`（构建链含 step0 图标） |
| 图标 | `scripts/make-icon.ps1`（生成 app.ico/favicon 源）、`gui/shell/app.ico`、`gui/web/favicon.svg` |
| 前端 | `gui/web/index.html`（骨架/挂载点）、`app.js`（逻辑/i18n/API 封装）、`style.css`（暗色主题） |