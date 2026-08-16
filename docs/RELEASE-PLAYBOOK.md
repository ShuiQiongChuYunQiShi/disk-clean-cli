# disk-clean 制作与发布 SOP —— 可复用 Playbook

> 本文是**操作手册**（照着做就行），与 `PROCESS-REVIEW.md`（复盘：学了什么）互补。
> 适用范围：在 DeepSeek Harness（DSH）上制作 Windows 磁盘工具——三形态交付（DSH 插件 + 独立 CLI + GUI 桌面端），
> 上传 GitHub，打包 Release。新项目可直接复用本流程。

---

## 0. 机制总览（先看这张图）

```
引擎（唯一权威源）
   ├─► DSH 插件（对话式 AI）：plugin/plugins/dsk-adv.js + dsk-lib/（= CLI lib 副本）
   │     静态 presethost.static5.js（会话挂载即用，免审批）
   │     动态模板 host.js（__DSK_DIR__ 占位，cordis_define 安装，带可视化面板）
   ├─► 独立 CLI（Node / SEA 单文件 exe）：bin/ + lib/ + scripts/build-sea.ps1
   └─► GUI 桌面端（WebView2 原生窗口）：gui/ + lib/serve.js（界面前端 + HTTP 服务层）
            ├─ C# 壳（WinForms+WebView2，.NET 8 框架依赖单 exe ~24MB，UAC 提权）
            │    spawn engine.exe serve --port <p> --token <t> --web <dir>
            ├─ lib/serve.js：8 工具 REST 化（仅绑 127.0.0.1 + Bearer 鉴权）
            └─ gui/web/：零依赖暗色仪表盘（主页极简 + 高级 8 Tab，双语）
                    │
                    ▼
   Inno Setup 安装器（检测 .NET 8 Desktop Runtime / WebView2，缺则引导官方 bootstrapper）
            │
            ▼
   GitHub 仓库（同一仓库承载三侧）→ Release 资产（setup exe + 引擎 exe + SHA256SUMS）→ CI 回归
```

- **同源铁律**：引擎只写一处；插件 `dsk-lib/` 与 CLI `lib/` 互为副本，改动必须**双向同步**；
  GUI 的 `lib/serve.js` 只包装引擎（零重写），引擎改动 GUI 自动受益。
- **三条分发线共享同一仓库**：CLI 是第一入口（Release 资产），插件放 `plugin/` 目录，
  GUI 放 `gui/` + `installer/` 随仓库分发。

---

## 1. 新项目启动（骨架）

```
<repo>/
├── bin/            # CLI 入口（disk-clean.js，含 VER 版本常量）
├── lib/            # CLI 引擎（engine.js / health.js / mftscan.js / dedup.js / quota.js / serve.js…）
├── scripts/        # build-sea.ps1（**全 ASCII**，SEA 打包）
├── test/           # CI smoke test（**仓库内相对路径，禁止本机绝对路径**）
├── docs/           # RELEASE-PLAYBOOK.md / PROCESS-REVIEW.md / GUI-PLAN.md / RELEASE_NOTES-*.md
├── gui/            # GUI 桌面端：shell/（C# 壳）+ web/（前端）+ stage|publish|dist（构建产物）
├── installer/      # Inno Setup 安装器脚本（disk-clean-ui.iss）
├── plugin/         # DSH 插件分发目录（见 §2）
├── .github/workflows/
├── README.md       # Option A 单文件 exe / Option B npm / Option C DSH 插件 / Option D GUI（链接各文档）
├── CHANGELOG.md
└── package.json / sea-config.json / LICENSE / ROADMAP.md
```

**起步顺序**：`package.json + git init` → 引擎最小可跑 → 双形态骨架 → 首个 Commit 就入库（编码铁律见 §5）。

---

## 2. 插件制作 SOP（DSH）

### 2.1 双形态（必须同时维护）

| 形态 | 文件 | 加载方式 | 适用 |
|---|---|---|---|
| 静态插件 | `plugin/plugins/disk-analyzer/host.static5.js` | `agent.cordis.yml` 直接引用，**会话挂载即注册工具**，免 cordis_define / 免审批 | 模型侧工具 + 文本报告（主推） |
| 动态模板 | `plugin/plugins/disk-analyzer/host.js` + `client.js` | `__DSK_DIR__` 占位 → cordis_define 安装 | 交互式图表面板（可选增强） |

### 2.2 目录结构（preset 根 = 任意主机预设 id）

```
.env 预设根/<id>/
├── agent.cordis.yml                 # 预设组成（插件行 name: './plugins/disk-analyzer/host.static5.js'）
├── preset.yml
├── plugins/
│   ├── dsk-helper.js                # 引擎辅助进程
│   ├── dsk-adv.js                   # 高级功能辅助进程（健康/MFT/去重/配额）
│   ├── dsk-lib/                     # 高级功能引擎（与 CLI lib/ 同源）
│   └── disk-analyzer/{host.static5.js, host.js, client.js, dsk-client.js, dsk-helper.js}
└── skills/                          # 使用手册（SKILL.md 注入新会话）
```

### 2.3 路径铁律（防发布即坏）

- **禁止硬编码机器路径**（如 `C:\Users\Administrator\...`）。`host.static5.js` 顶部用
  `require('node:path')` + `__dirname` 推导：`path.resolve(__dirname, '..', '..')` = preset 根。
  try/catch 回退旧硬编码兜底。发布前 grep 全目录确认无 `Administrator` / 开发机盘路径。
- 相对引用（`agent.cordis.yml` → `./plugins/...`）以 preset 根为基准，**复制后保持结构不变**。

### 2.4 工具注册（两种风格，二选一配套）

- 静态插件：`ctx.tools.register(tool)`（`inject: ['timer','tools']`），工具对象 `{ name, description, schema, action }`。
- 动态插件：`harness.defineTool({...})` + `harness.registerTool(ctx, tool)`。
- 工具命名 `disk_*` 前缀；描述必须自含完整用法（模型只读 description）。

### 2.5 辅助进程模式（关键）

- 辅助进程（dsk-helper / dsk-adv）为**纯 Node**：原生 `fs`、**不用 `spawnSync`**（沙箱管道限制），
  输出协议 `'\n' + JSON.stringify(obj)`，宿主 `parseHelperOut` 取 lastIndexOf('\n') 之后解析。
- 宿主用 `ctx.get('subprocess')` 以 `spawn(node, [...argv])` 启动；`cwd` 用固定盘根即可。
- 高级功能统一走 dsk-adv.js 多模式分发：`mftscan <drive>` / `dedup <json>` / `dedup-hardlink <json>` /
  `dedup-rollback <json>` / `quota <drive>`。

### 2.6 安全模型（插件独有，CLI 可借鉴）

1. 默认只建议不执行；删除 = 预览 → 用户确认 → **DSH 审批**（`approval.request`，双确认）。
2. 优先移入回收站（可恢复）；仅回收站清空永久删除。
3. **白名单**：执行路径必须来自最近一次报告的建议明细，拒绝一切清单外路径。
4. 系统目录只统计不清理。
5. 每次执行写 `.dsk-audit.json` 审计（时间/类型/路径/字节/结果）。
6. 删除走 PowerShell（UTF-16LE base64 + 单引号转义）；**硬链接用 `fs.linkSync` 而非 PowerShell New-Item**
   （沙箱管道问题），备份 `victim → victim.dsk-dup-bak`，失败回滚。
7. 破坏性操作一律可回滚：整理/去重写映射文件（organize-map / dedup-map）。

### 2.7 插件验证清单

- [ ] 全部 `.js` 过 `node --check`
- [ ] 端到端：scan → report → clean(审批) → organize plan/apply/rollback → audit
- [ ] 高级功能实测：health（温度/寿命）、mftscan（MFT 记录数）、dedup（≥1MB 重复组 + hardlink + rollback）、quota
- [ ] grep 确认无机器路径（`Administrator` / `D:\` 开发目录）
- [ ] **新开会话**才能看到新工具（静态插件会话挂载时注册，不热更新）——告知用户

### 2.8 插件发布进仓库

- 镜像已安装最新版 → `plugin/`（**以安装位置为基准**，product 源可能有旧副本，先比对哈希再镜像）。
- `plugin/README.md`：安装（复制到 `.agent-presets/<id>/`）/ 使用 / 安全模型 / 目录结构。
- 仓库主 README 补 Option C 链接（**不要用 `../README.md` 这种仓库外链接**）。

---

## 3. CLI 制作 SOP

### 3.1 构建

- `scripts/build-sea.ps1`：`esbuild bundle → node --experimental-sea-config → postject` 全离线；
  **脚本全 ASCII**（CI 用 pwsh7，中文会破坏字符串）。
- 版本常量 `VER` 在 `bin/disk-clean.js`；SEA 单入口，子进程自我调用走 `--internal-*` 参数，
  按 `IS_SEA`（`process.execPath` 含 `sea`）分派脚本路径。
- 依赖：Node 内建 `fs/crypto/child_process` + PowerShell 补齐系统能力（COM 快捷方式 / SMART / 计划任务），
  零运行时依赖。

### 3.2 验证清单

- [ ] 本地全量回归（scan / report / organize / clean / fix-shortcuts / audit / health / mftscan / dedup / quota）
- [ ] 重打包 exe 后**重新跑全命令**（exe 与源码永远同步）
- [ ] 版本 bump + CHANGELOG + ROADMAP 状态表同步
- [ ] 与插件侧同源文件比对（`lib/` ⇄ `plugin/plugins/dsk-lib/`）确认同步

---

## 3.5 GUI 桌面端制作 SOP（WebView2 原生窗口）

### 3.5.1 架构（三进程模型）

```
disk-clean-ui.exe（C# WinForms+WebView2 壳，.NET 8 框架依赖单 exe ~24MB）
  ├─ app.manifest requireAdministrator（UAC 提权，磁盘分析必需）
  ├─ TcpListener(IPAddress.Loopback, 0) → 找空闲端口 + Guid 生成 token
  ├─ spawn engine.exe serve --port <p> --token <t> --web <dir>
  │    （CreateNoWindow + 隐藏窗口 + 重定向 stdout/stderr UTF-8）
  ├─ 轮询 GET /api/health（30s 超时 / 300ms 间隔）确认引擎就绪
  └─ WebView2 窗口加载 http://127.0.0.1:<port>/（窗口关闭 → KillEngine 整进程树）
```

- **壳零业务逻辑**：C# 只做「提权 + 拉起引擎 + 托管 WebView2」三件事，8 个工具全部
  复用 CLI 引擎 `lib/serve.js` HTTP 层 —— GUI 永远与服务层/CLI 同源。
- **WebView2 环境**：`CoreWebView2Environment.CreateAsync(userDataFolder=%LOCALAPPDATA%\disk-clean\webview2)`
  → `EnsureCoreWebView2Async` → `AddScriptToExecuteOnDocumentCreatedAsync` 注入
  `window.__DSK_TOKEN__` 与 `window.__DSK_URL__` → `Navigate`。异常弹 MessageBox 并 Close。
- **前端 token**：`window.__DSK_TOKEN__ || new URLSearchParams(location.search).get('token')`——
  兜底 URL query 便于 headless 测试与手工调试，不破坏 C# 注入主路径。

### 3.5.2 服务层（lib/serve.js）铁律

- **只绑 127.0.0.1**；除 `/api/health` 外全部要求 `Authorization: Bearer <token>`。
- **CLI 命令是位置参数不是 flag**：spawn 传 `serve`（位置）而非 `--serve`（flag 会被
  parseOpts 当布尔 → cmd=undefined → 打印 help 退 0）。这是本模块最高频坑。
- 扫描任务：spawn 子进程 `--internal-scan`（SEA 自调用 `['--internal-scan']`，node 环境
  `[process.argv[1], '--internal-scan']`）+ `--progress <tmpfile>` 轮询；
  report 落 `audit.reportFile()`。
- **clean 空路径自动提取**：GUI 一键清理传 `paths: []` 时，从最近报告自动提取候选
  （`extractCleanPaths`：duplicates←建议 removable / empty-dirs←emptyDirSample /
  junk-temp←temp 段过滤），与 CLI 提取逻辑一致；提取不到则安全拒绝（宁拒勿删）。
- 静态托管：`STATIC_EXT` 白名单 + `path.resolve` 前缀校验防目录穿越。
- **盘符容量铁律**：`/api/drives` 必须用 `fs.statfsSync(drive+':\\')` 返回
  `{total: bsize*blocks, free: bsize*bfree, avail: bsize*bavail, used: total-free}`。
  **绝不 `fs.statSync(root).blocks*512`**（那是根目录自身占用的块数，实测只有 ~24KB——
  v0.3.0 的“盘符显示 24kb”即此根因）。Node ≥18.15 才有 statfsSync（本仓库 SEA 为 Node 22）。
- **范围型操作铁律（扫描/去重/整理）**：服务端缺省 roots **只能回退最近报告
  `summary.roots`**，无报告则 400 要求显式传入——绝不静默回退全盘
  （v0.3.0 dedup 硬链接空 roots 曾回退扫 C:\+D:\，与预览范围不一致）。
- **扫描取消**：`POST /api/scan/cancel {job}` → `proc.kill()`（SIGTERM → engine 置
  cancelled，报告 status=cancelled 保留部分结果）；任务已完成返回 note、未知任务 404。
- 常驻：`cmdServe` 返回 `new Promise(function(){})`；SIGTERM/SIGINT shutdown 杀全部 job 子进程。

### 3.5.3 前端（gui/web/，零依赖）

- 手写 HTML/CSS/JS（**零 npm 运行时、零构建**——引擎 SEA 无需打包前端，体积小、无供应链风险）。
- 两级 UI：主页（选盘/扫描进度/统计卡/类别条形图/建议卡+一键清理）+
  高级 8 Tab（organize/health/dedup/quota/mft/schedule/config/audit）。
- 双语 i18n：`data-i18n` 属性 + `localStorage` 切换（zh 默认 / en）；SVG-free（CSS bar 图）。
- 清理/整理一律「预览 → 确认弹窗 → 执行」双确认；毁伤操作接口后端默认 dryRun。
- **选择策略（v0.3.1）**：首次启动默认只选 D:（不存在则取第一个盘）、`localStorage` 记忆
  上次选择；「全选/清空」快捷按钮；`syncDriveCards()` 保证卡片视觉态与数组一致。
  绝不做"默认全选"——v0.3.0 曾因全选+点击切换导致"以为选 D 实际扫 C+E+F（2.2TB）"。
- **扫描前必须弹范围确认**：列出各盘已用/合计/可用 + 排除路径 +「扫描只读」提示，
  确认后才 startScan（防误扫的一票否决点）。
- **报告顶部必须回显扫描范围**（`summary.roots`）+ cancelled 徽章（部分结果）。
- 扫描中提供「取消」按钮（POST /api/scan/cancel）；dedup 合并/清理执行后提示
  "统计为清理前快照，可重新扫描刷新"。
- 高级页细节：MFT 盘符从 `/api/drives` 动态生成（勿硬编码 C/D/E/F）；schedule
  weekly 必须提供 day 下拉（服务端校验 MON..SUN，缺省必 400）；quota 缺省盘用
  lastDrives[0] 兜底。

### 3.5.4 安装器（installer/disk-clean-ui.iss + scripts/build-installer.ps1）

构建链（**顺序铁律**：先引擎后壳，改 serve 后必须先重建 SEA）：

```
scripts/build-installer.ps1
  0) scripts/make-icon.ps1（System.Drawing 画 256 主图 → 16~256 多尺寸 PNG → PNG-in-ICO）
  1) dotnet publish gui/shell/DiskCleanUi.csproj -c Release -r win-x64 --self-contained false \
     -p:PublishSingleFile=true -o gui\stage
  2) scripts/build-sea.ps1（esbuild bundle + SEA blob + postject；产物 dist\disk-clean-win-x64.exe）
  3) Copy dist exe → gui\stage\engine.exe + Copy gui\web\* → gui\stage\web\
  4) ISCC installer\disk-clean-ui.iss → gui\dist\disk-clean-setup-<ver>.exe（LZMA2 压缩）
  5) sha256 写入 .sha256
```

- **图标三处接入**：csproj `<ApplicationIcon>app.ico</ApplicationIcon>`（exe/任务栏）、
  iss `SetupIconFile=..\gui\shell\app.ico`（安装器）、web `favicon.svg`（页面，serve
  静态白名单已含 .ico/.svg）。make-icon.ps1 是构建链 step 0，确保可复现。
- **PS 5.1 图标脚本铁律**：`New-Object Type(` 参数列表**跨多行会解析失败返回 null**——
  所有构造调用必须单行或 `::new()`；脚本注释保持**全 ASCII**（BOM-less UTF-8 中文会被
  ANSI 错读导致诡异失败）。本项目其余 .ps1 同理。

- **框架依赖 + 缺则引导**（体积优先，不自包含）：.iss `[Code]` 检测 .NET 8 Desktop Runtime
  与 WebView2，缺失时弹窗 → `DownloadTemporaryFile` 拉官方 bootstrapper → 静默安装。
- **运行时检测用文件夹探测**（`DirExists` + `FindFirst('...\8.0.*')`）比注册表可靠
  （注册表布局因安装器而异，实测误判）。WebView2 用注册表探测。
- **Inno Setup PascalScript 铁律**：
  - 函数**必须先声明后使用**（无前向引用，DownloadAndRun 定义放在 InitializeSetup 之前）。
  - `DownloadTemporaryFile` 实际签名 4 参：`(Url, BaseName, RequiredSHA256OfFile, OnDownloadProgress): Int64`，
    失败返回 -1；**BaseName 只传裸文件名**（自动落到 `{tmp}`），传全路径会前缀重复。
  - `FindFirst`/`FindClose` 用 `TFindRec` 结构体，不是 String。
  - 中文向导语言文件（ChineseSimplified.isl）官方安装包不带——向导用英文，程序 UI 双语不受影响。
- 安装产物校验：静默安装 `/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /DIR=<测试目录> /NOCANCEL`
  → EXIT=0 且 `disk-clean-ui.exe + engine.exe + web\ + unins000.exe` 就位 → 从安装目录启动 GUI
  → 引擎 health OK / index 200。

### 3.5.5 GUI 验证清单（验收点）

- [ ] 原生窗口标题正确、无黑框（WebView2 先于窗口显示）
- [ ] 无 token 请求 401；带 token drives/scan/organize/… 全部 200
- [ ] **数据正确性三重断言**：`report.summary.roots == 所选`；`totalBytes ≤ 卷容量`
      （statfsSync 对照）；`categorySum == totalBytes`（0 差）——用真机全量扫描验证
- [ ] 扫描 → 进度轮询 → report 完整返回；clean 空路径自动提取
- [ ] 扫描取消：任意状态可 cancel（done 任务返回 note、未知 404）；**取消测试用临时
      report 路径**（`body.report=$TEMP\x.json`），避免覆盖好报告
- [ ] **Edge headless 渲染**：`msedge.exe --headless=new --disable-gpu --user-data-dir=<临时> --dump-dom --virtual-time-budget=8000 "http://127.0.0.1:<port>/?token=<t>"`
      → 检查 nav-item / drive-card / 真实容量数字 / 默认选中 D / 无 `Uncaught|ReferenceError|TypeError`
      （旧 `--headless` 模式可能空输出，必须 `--headless=new` + 独立 profile）
- [ ] PS 5.1 调 API 发中文 JSON 用 `[Text.Encoding]::UTF8.GetBytes($json)` 字节体
      （字符串体默认 Latin-1，中文变 `???` 造成假 400）
- [ ] 安装器静默安装 EXIT=0 → 启动即用（引擎 spawn 日志出现 serve 行）
- [ ] **从 GitHub 下载 → Get-FileHash 与本地一致 → 静默安装 → 启动 → 健康 → 页面 200**
      （完整用户路径才是发布成功的判据；`dist/SHA256SUMS.txt` 是发布时组装的，build-sea
      只写 `dist/checksums.txt` + `exe.sha256`，发布前重算并双向核对）

---

## 4. GitHub 发布 SOP

### 4.1 认证（坑多，照做）

- `gh` 位于 `C:\Program Files\GitHub CLI\gh.exe`。
- **fine-grained PAT 不能用 `gh auth login --with-token`（报 401）**——用环境变量：
  `$env:GH_TOKEN = '<token>'`（每次 pwsh 调用前注入，变量不跨调用持久）。
- token 权限不足时不能创建仓库：明确列出选项（换 token / 手动建仓库）让用户选，不卡住。

### 4.2 提交规范

- 英文 commit message，单 commit 一个主题；文档与代码同步提交。
- 发布前：本地全量回归 → 版本 bump → commit → tag → Release 说明 → SHA256，**GitHub 只做搬运**。

### 4.3 Release 资产

```
disk-clean-setup-<ver>.exe   （GUI 安装器 ~26MB，LZMA2 压缩；gh release create 上传超时 → 后台任务跑）
disk-clean-setup-<ver>.exe.sha256
disk-clean-win-x64.exe   （CLI/引擎 SEA，~82MB，同上后台上传）
disk-clean-win-x64.exe.sha256
SHA256SUMS.txt          （含引擎 + 安装器两项校验和）
checksums.txt           （version=<版本> 行，构建产物）
```

- **发布前产物核对铁律**：`Get-FileHash` 与 Release 资产 digest 一致才算发布成功；
  `dist/` 被 .gitignore 忽略，SHA256SUMS 只作 Release 资产不入库，**每次构建后必须重算**。
- 上传一律后台任务 + `--clobber` 覆盖；**上传期间不要重建源文件**（会破坏半传文件），
  需重传先 kill 上传 job 再重建再传。
- Release 必须**非 draft**；CI workflow 手动验证（`gh workflow run` 在 CI 修复后重新触发，不删 tag 重推）。
- 遗留 draft 删除：`gh release delete` 偶发静默失败（exit 0 未删）——用 API
  `DELETE /repos/{owner}/{repo}/releases/{id}` 兜底（返回 204）。

### 4.4 CI 铁律

- 测试代码**禁止本机绝对路径**（CI 目录 `D:\a\...`），用仓库内相对路径 + 运行时自建测试树。
- 语法检查覆盖**全部** bin/lib/*.js（不只 4 个核心）。

### 4.5 发布检查清单

- [ ] `git status` 干净、`git log` 与 `ls-remote origin master` 一致
- [ ] Release 非 draft、资产哈希与本地一致（含 GUI setup 与引擎两处 sha）
- [ ] CI 最新 run 成功
- [ ] README（Option A/B/C/D 链接）+ CHANGELOG + ROADMAP 无坏链接
- [ ] 版本三处一致：`bin/VER`、`lib/serve.js VER`、`package.json version`（GUI 壳
      `DiskCleanUi.csproj Version` 与引擎版本同号）——发布前 grep 核对，防版本漂移

---

## 5. 编码与 Windows 兼容铁律（最高频事故区）

1. 文件操作统一 **UTF-8 无 BOM**。PowerShell 5.1 `-Encoding UTF8` 会写 BOM 且按 ANSI 读入——
   中文必坏。用 Node 写文件或显式无 BOM 写法。
2. 跨进程输出（schtasks 等）：**严格 UTF-8 解码失败回退 GBK**
   （`TextDecoder('utf-8',{fatal:true})` → `TextDecoder('gbk')`）。
3. 脚本文件（build.ps1 / CI 脚本）**全 ASCII**。
4. PowerShell 调用：
   - 多行脚本**写 .ps1 + `-File` 调用**，绝不 `-Command` 传多行（参数被拆行）。
   - `cmd /c` 命令**整体包裹引号**：`cmd /c ""exe" args"`。
   - `&&` 是 pwsh7 语法——**PS 5.1 不支持**，用分号分隔。
   - Node 路径含反斜杠：**先存变量再 `& $var`**；含引号/反斜杠的 JSON 参数写文件传参或 `cmd /c` 包裹，
     不要直接内联（引号被剥）。
5. MFT 解析（NTFS 碎片）：
   - runlist 驱动读取，不假设连续；符号扩展/累加禁用 `<<` 32 位运算，用 `Math.pow`。
   - 稀疏/异常 size 兜底：`alloc ≤ real×2+4MB 用 alloc 否则 real`；size 超卷容量归 0。
   - 字段偏移以实测定准（DATA real@+48、FILE_NAME name@+66 等），改动后对照普通遍历验证（§3 PROCESS-REVIEW #5）。

### GUI/C#/安装器（v0.3.0 增补）

6. C# 项目（`gui/shell/`）Nullable disable 下**不要写 `?` 注解**（CS8632）；
   `GetArg` 返回 `string.Empty` 而非 null，判断用 `IsNullOrEmpty`（`??` 对空串无效）。
7. 引擎 stdout/stderr 重定向必须 `StandardOutputEncoding = UTF8`；日志文件 UTF-8，
   PowerShell 读取**必须 `-Encoding UTF8`**（默认按 GBK 读中文乱码，曾误判为引擎输出问题）。
8. **PowerShell 5.1 `New-Object ProcessStartInfo` 无 `ArgumentList`**（pwsh7 才有）——用
   `Arguments` 字符串，含空格路径加 `\"` 包裹；C# `ProcessStartInfo.ArgumentList` 只在 .NET 运行时可用。
9. 安装器 PascalScript：函数先声明；`DownloadTemporaryFile` 4 参 Int64（-1=失败）；
   `BaseName` 裸文件名；`FindFirst` 用 `TFindRec`；缺 ChineseSimplified.isl 用英文向导。
10. GUI 构建产物（`gui/stage/` `gui/publish/` `gui/dist/`）全部 .gitignore，勿提交；
    安装器版本行（checksums.txt `version=`）来源是 `package.json`——bump 时同步，防标签漂移。
11. PS 5.1 **无三元运算符 `? :`**（解析错误）——用 if/else。gh/PSScript 输出解析
    PowerShell 5.1 会把 stderr 混进 stdout（NativeCommandError 噪音）——用 `Out-String`
    或重定向到文件再解析，复杂 JSON 直接用 Invoke-RestMethod API 层验证。
12. **盘符容量 = `fs.statfsSync` 唯一解**（`statSync(root).blocks` 是目录自身块数，显示
    24kb 事故即此）。GUI `/api/drives` 返回 `{total, free, avail, used}`，前端卡片画
    进度条 + 已用/可用。
13. **范围型操作（扫描/去重/整理）三要件**：界面默认只选数据盘并记忆、操作前范围确认
    弹窗、服务端缺省只回退最近报告 roots。**禁止静默全盘**（曾致 dedup 硬链接扫 C+\+D\、
    主页误扫 C+E+F）。
14. **PS 5.1 脚本构造调用单行 / `::new()` + 全 ASCII 注释**；`New-Object Type(` 跨行
    → 解析失败返回 null；BOM-less UTF-8 中文注释被 ANSI 错读。
15. PowerShell HTTP 测试发中文 JSON：`Invoke-WebRequest -Body ([Text.Encoding]::UTF8.
    GetBytes($json))` + `Content-Type: application/json; charset=utf-8`（字符串体 Latin-1
    会把中文变 `???`，误报 400）。

---

## 6. 新会话复用指南（回答"新开会话还能不能用"）

**对话记忆不会带到新会话，但流程载体可以——用以下任一方式让新会话复用：**

1. **DSH 技能（推荐）**：本 preset 携带 `skills/release-sop/SKILL.md`（发布流程）与
   `skills/gui-development/SKILL.md`（GUI 桌面端专项，v0.3.0 新增），新会话的技能目录会自动出现；
   对模型说“按 release-sop 流程做 XXX”或“按 gui-development 做 GUI”，即加载对应速查。
2. **仓库文档**：直接要求模型读 `docs/RELEASE-PLAYBOOK.md`（本文件）+ `docs/PROCESS-REVIEW.md`
   （错误清单）+ `docs/GUI-PLAN.md`（GUI 设计），命令示例：
   ```
   读取 D:\deepseekHerness\disk-clean-cli\docs\RELEASE-PLAYBOOK.md 和 PROCESS-REVIEW.md，
   按 §2 插件 SOP 把新功能 XXX 加入磁盘分析器插件并走 §4 发布流程。
   读取 D:\deepseekHerness\disk-clean-cli\docs\GUI-PLAN.md 与工具 skills/gui-development，
   按 §3.5 GUI SOP 修改前端/安装器。
   ```
3. **技能 = 指针，手册 = 权威**：SKILL.md 只放速查与定位（“读哪些文件、按哪几节做”），
   完整内容始终以仓库 docs/ 为准，避免两份文档漂移。

> 最佳实践：新会话开头先让它读本手册 + PROCESS-REVIEW，再开始动工；编码铁律（§5）每题必查。