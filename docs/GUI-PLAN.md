# disk-clean GUI v1.0 — 实施计划（WebView2 原生窗口）

> 状态：已与用户确认全部决策（WebView2 / 手写前端 / 安装包 / 框架依赖+缺则引导 / 体积优先）。
> 本文档是执行的唯一依据，计划变更需回写此处。

## 目标

Windows 原生窗口（WebView2）图形化磁盘工具：全功能两级 UI（主页极简 + 高级页全功能），
Inno Setup 安装包分发。安装后 ~88MB（引擎 86MB 为 Node 运行时硬底），安装包下载 ~40MB。

## 最终架构

```
disk-clean-ui.exe  (C# 壳 WinForms + WebView2, .NET 8 框架依赖 ~1.5MB)
 ├─ app.manifest requireAdministrator → 启动即 UAC 提权（管理员）
 ├─ 找空闲端口 + 生成随机 token
 ├─ spawn engine.exe --serve --port <p> --token <t>（CreateNoWindow）
 ├─ 健康轮询 /api/health 就绪 → 启动 WebView2 窗口
 └─ WebView2 = 本地前端（fetch 全部带 token header）

engine.exe = 现有 Node SEA 打包（8 工具零重写），新增 lib/serve.js HTTP 层
安装器 = Inno Setup（检测 .NET 8 Desktop Runtime / WebView2 运行时，缺则引导下载）
```

## 仓库新增结构

```
disk-clean-cli/
├── gui/
│   ├── shell/                  # C# 壳
│   │   ├── DiskCleanUi.csproj  # .NET 8 / 框架依赖 / 单 exe / WebView2 NuGet
│   │   ├── Program.cs          # 提权校验 → 空闲端口 → spawn 引擎 → 健康轮询 → MainForm
│   │   ├── MainForm.cs         # WebView2 窗口；关闭时 kill 引擎进程
│   │   └── app.manifest        # requireAdministrator
│   ├── web/                    # 前端（零依赖手写）
│   │   ├── index.html
│   │   ├── style.css           # 暗色仪表盘
│   │   └── app.js              # 两级导航 / API 调用 / SVG 图表
│   └── publish/                # 构建产物（安装器素材）
├── lib/serve.js                # 引擎 --serve HTTP 层
├── scripts/build-gui.ps1       # C# 壳 + 引擎 --serve 构建 → gui/publish/
├── scripts/build-installer.ps1 # Inno Setup 打包
└── installer/disk-clean-ui.iss
```

## 阶段 / 任务 / 验收

### P0 环境准备（0.5 天）
- winget 安装 .NET 8 SDK、Inno Setup
- `dotnet --version`、`iscc` 可用
- 建 gui/ 目录骨架
- 验收：两个工具命令可用

### P1 C# 壳骨架（1 天）
- csproj：net8.0-windows、WinForms、UseWinForms、框架依赖、单文件发布模式、Microsoft.Web.WebView2 包
- Program.cs：管理员检查（非 admin 提示重启用 UAC）、TcpListener 找 0 端口、随机 token、
  Process.Start 引擎（CreateNoWindow+隐藏）、/api/health 轮询就绪、Application.Run
- MainForm.cs：WebView2 初始化、Navigate 到 http://127.0.0.1:port/、FormClosing 杀引擎进程
- app.manifest：requireAdministrator
- **验收点①**：双击 exe → UAC → 原生窗口显示 hello 页（无黑框）

### P2 引擎 --serve HTTP 层（1 天）
- bin/disk-clean.js 增加 `serve` 子命令：`disk-clean serve --port <p> --token <t>`
- lib/serve.js（零外部依赖，node:http）：
  - GET  /api/health           → {ok, version}
  - POST /api/scan {roots,exclude} → jobId；GET /api/scan/{id} 进度轮询（阶段/文件数/大小/建议）
  - POST /api/clean {type,paths,confirm} → 执行（复用 lib/clean.js）
  - POST /api/organize {cmd:plan|apply|rollback, items}
  - GET  /api/audit
  - GET  /api/health-check、POST /api/mftscan、POST /api/dedup、POST /api/quota、POST /api/config、POST /api/schedule
  - 全部请求检查 Authorization: Bearer <token>（/api/health 例外也可带）
  - 仅绑定 127.0.0.1；CORS 免（同源）
- **验收点②**：curl 全部 API；未带 token 的 /api/scan 返回 401

### P3 前端两级 UI（3–4 天，工作量主体）
- 主页：盘符卡（drives）→ 一键扫描（选盘+exclude）→ 实时进度条 → 建议卡（组织/大文件/重复/回收站/空目录）→ 一键清理按钮（带确认）
- 高级页 Tab：
  - 整理：plan 预览表 → apply（勾选项）→ rollback
  - 健康：盘温度和 SSD 寿命表 + 健康分级
  - 去重：扫描 → 重复组列表 → 硬链接合并 / 回滚
  - 配额：用户排行 + 子目录明细
  - MFT：快速扫描统计
  - 计划任务：schedule add/run/list/remove
  - 配置：config 规则表单
  - 审计：audit 日志表
- 统一 token：启动时从壳注入（WebView2 环境变量或 URL 参数），fetch 带 Authorization
- 手写暗色 CSS + 原生 SVG 图表（饼图/条形图/环形进度）
- 双语：zh 默认 + en 切换（语言切换存 localStorage）
- **验收点③**：真机扫描 30 秒出建议；清理/整理带确认+进度；全 Tab 可用

### P4 Inno Setup 打包（1 天）
- installer/disk-clean-ui.iss：
  - 检测 .NET 8 Desktop Runtime（注册表）+ WebView2 runtime，缺则静默引导下载（官方 bootstrapper）
  - 安装目录：Program Files\disk-clean；开始菜单快捷方式；卸载器
  - 文件：PluginDiskCleanUi.exe + engine.exe + web/ 前端资源
  - 压缩：LZMA2，solid；图标
- scripts/build-installer.ps1：调 dotnet publish → 拷贝 → iscc
- **验收点④**：干净环境从零安装全流程通过；安装包体积报告

### P5 测试与发布（1–2 天）
- 端到端：8 工具全流程 GUI 冒烟
- 杀软误报核查（Defender 实时防护临时验证；360 等第三方告知风险）
- 界面双语验收；CHANGELOG；README 增 GUI 章节
- Release：v0.3.0（GUI 首版），资产 = GUI 安装包 + sha256 + 既有 exe
- **验收点⑤**：全部验收点回看通过，Release 资产齐全

## 硬约束（贯穿全程）

- 编码：UTF-8 无 BOM；脚本内 ASCII；跨进程严格 UTF-8 回退 GBK
- 引擎零重写：只新增 lib/serve.js 包装，8 工具业务逻辑不动
- 安全：仅绑定 127.0.0.1、随机端口、Bearer token 鉴权、清理/移动仍需用户界面二次确认
- 提权：只需壳层 manifest；引擎子进程继承管理员
- 体积：不引入任何 UI 框架/运行时；前端零依赖；C# 壳保持框架依赖
- 版本/同步：每次改动同步仓库并更新 CHANGELOG；commit 粒度=一个验收点

## 风险登记

| 风险 | 影响 | 缓解 |
|---|---|---|
| 无签名 exe 杀软误报 | 部分用户装不上 | 安装器+目录结构；文档说明；后续可购 OV 证书 |
| .NET 8 Desktop Runtime 缺失 | 首次安装需下载 ~30MB | 安装器引导官方 bootstrapper |
| engine 86MB 体积硬底 | 安装后 ~88MB | 已确认接受；LZMA2 压缩下载 ~40MB |
| SEA exe 被提权后 spawn 行为 | 子进程继承 admin | P2 端到端验证 |