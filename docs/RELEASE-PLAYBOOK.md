# disk-clean 制作与发布 SOP —— 可复用 Playbook

> 本文是**操作手册**（照着做就行），与 `PROCESS-REVIEW.md`（复盘：学了什么）互补。
> 适用范围：制作 Windows 磁盘工具——三形态交付（独立 CLI + MCP server + GUI 桌面端），
> 上传 GitHub 与 npm，打包 Release。新项目可直接复用本流程。

---

## 0.0 项目定位与版本号规则（2026-09-12 定，改动需回写本节）

### 定位

| 定位 | 形态 | 含义 |
|---|---|---|
| **主入口（产品）** | **GUI 桌面端** | 面向用户的主产品；体验打磨优先投入 |
| **引擎面（必须先完整）** | **CLI / 单文件 exe** | GUI 内部调用的就是它（安装后的 `engine.exe` 与 `disk-clean-win-x64.exe` 是同一文件），所以能力必须最先齐 |
| **AI 面（跟随）** | **MCP server** | CLI 的薄封装，同步成本低 |

**注意**：`disk-clean-win-x64.exe`（82MB）与 `disk-clean-setup-<ver>.exe`（26MB）是两个不同的东西——
前者是 **CLI 的单文件版**（运行即命令行），后者是 **GUI 的安装器**。把二者混为一谈会把方向搞反。

### 版本号规则（重要：此前升得太快）

| 位 | 何时升 | 例子 |
|---|---|---|
| **major** | 尚无（未到 1.0） | — |
| **minor**（第二位） | **仅当新增独立能力**或破坏性变更 | 引入 MCP、删除插件形态；后续的"报告历史""分类规则重建" |
| **patch**（第三位） | **其余全部**：修 bug、安全修复、性能、文档、测试、配置修正、错误消息、加个小命令、兑现已有承诺 | v0.7.1 起的全部修复版本 |

**已发生的偏差（供参考，勿重犯）**：

- v0.6.0 内容为**纯安全修复**、零新功能 → 按本规则应为 **0.5.1**
- v0.7.0 内容为假承诺/一致性/性能修复，仅加了 `drives` 小命令 → 应为 **0.6.1**

> 已发布的版本号**不改写**（tag 与 npm 版本是公开事实）。新规则**从下一个版本开始执行**。

### 研发/发布统一入口（2026-09-12 新增）

流程要做进工具，而不是只写进文档。所有研发与发布动作走这一个入口：

```powershell
node scripts/dev.js doctor         # 环境与凭据自检（依赖/工具链/token/git 连通性/状态目录/审批目录/版本一致性）
node scripts/dev.js verify         # 一键验证链（语法 → 14 套件 → .ps1 ASCII → 版本 → 清单 → 指纹 → exe 端到端）
node scripts/dev.js analyze        # 净变更行数与 S/M/L 分级（决定该走多重的验证流程）
node scripts/dev.js changelog      # 从 git log 生成 CHANGELOG 分类骨架
node scripts/dev.js release-guide  # 生成本次发版指南（准备清单/回滚预案/上线后验证）
```

配套脚本（发布链上的三道门）：

```powershell
node scripts/approval.js           # 发布审批门禁：无有效审批 → 退出 1；--yes/--force 被拒绝
node scripts/fingerprint.js        # 断言制品指纹 == 当前源码（版本 + commit + 是否脏树）
node scripts/manifest.js           # 读取 disk-clean.config.json（发布身份与产物清单，唯一事实源）
```

全部以**退出码**表达结果（0=通过，1=有问题），可直接作为发布前门禁。

> **为什么在 `scripts/` 而不在 `bin/`**：`bin/disk-clean.js` 是**要发布给用户的 CLI**
> （npm 的 `files` 只含 `bin`/`lib`，`scripts/` 既不进 npm 包也不进 SEA exe）。
> 开发工具不该污染产品入口，但统一成一条命令。
>
> 参考项目（`D:\学习\newCode\navigator`）的教训与移植分析见 `docs/SOP-UPGRADE-PLAN.md`，
> 其中**最关键的一条**：只有"脚本级拦截"是真的，文档写红线 ≠ 有红线。

---

## 0.1 三道脚本级门禁（阶段二，2026-09-12 新增）

这三件事都不再是"约定"，而是**会在错误发生时退出 1 的脚本**。它们的存在理由，
以及它们**不**能防住什么，都必须写清楚——不写清楚就会变成假安全感。

### 门禁一：发布审批（`scripts/approval.js`）

```
人：node scripts/approval.js confirm --version 0.7.1 --by "张三"    # 需手动键入版本号
门禁：node scripts/approval.js check --version 0.7.1               # publish-release.ps1 的第 0 步
```

- 审批文件落在 `~/.disk-clean/approvals/release-<ver>.json`。
- **审批绑定的是字节**：文件里封存每个产物的 `sha256`。批准之后重新构建 → 哈希变 → 门禁拒绝。
  这一条是本门禁与参考项目最实质的差别（它只绑定版本号字符串）。
- **30 分钟时效**，过期即失效，并打印实际过了多久。
- **没有旁路**：`--yes` / `-y` / `--force` / `--skip-approval` 会被显式拒绝并说明原因。
- 版本必须与 `lib/version.js` 的 `VERSION` 精确相等；不接受 `all` / `manual` / 通配。

> ⚠️ **能力边界（不要过度声称）**：这是**本机文件门禁**。一个能在本机任意写文件的代理
> 可以自己写这份审批文件，也可以直接改这个脚本——任何"本机文件 + 本机程序"的方案都拦不住它，
> 这是原理性上限。要真正的边界，只能让发布凭据（`GH_TOKEN` / `NPM_TOKEN`）不出现在
> 该代理可达的环境里。
> 所以本门禁的定位是：**把发布从"默认动作"变成"一个刻意、留痕、与具体字节绑定的动作"**。

### 门禁二：制品指纹（`scripts/build-bundle.js` + `scripts/fingerprint.js`）

- 打包时用 esbuild `--define` 注入 commit / 是否脏树 / 构建时间，exe 因此自带"我从哪来"。
  **不用生成文件**：生成物会引入"生成物是否已同步"的第四种状态。
- `disk-clean build-info` 输出这份自述；`--version` 在制品形态下追加构建短哈希。
- `fingerprint.js check` 断言：版本一致、commit == HEAD、构建时树是干净的。
  `--require-clean-worktree` 额外要求当前工作树已全部提交（发布脚本用）。
- 它拦住的典型事故：**先 build、再改代码、然后 publish**。版本号一致、哈希自洽、
  下载回验通过，但用户拿到的 exe 里没有最后那次修改——只有内嵌 commit 能识别这种情况。

### 门禁三：文档一致性（`test/docs-consistency.js`）

断言的都是机器可判定的事实：套件数 / 套件是否注册进 `test/all.js` / MCP 工具数量与名单 /
受保护段数量**且逐条枚举** / README 命令表里的命令真实存在 / 文档引用的 `scripts/*` 路径存在 /
配置项要么接线、要么登记为未实现、且不得被当成已有能力承诺。

> 这一项**比参考项目更强**：它的 doc-sync 只是一张映射表加人工自查，没有自动化检查，
> 结果主链早已不受保护而团队并不知道。
>
> 附带一条同等重要的：**写了测试却忘记注册进 `test/all.js`，等于它永不运行**。
> 这类"看起来很安全"的假绿现在会被门禁直接抓住。

### 完成前验证（铁律）

> **没有新鲜的验证证据，不许声称完成。**

- 禁用"应该 / 大概 / 似乎 / 看起来正常"作为结论。要么给出命令与输出，要么说"未验证"。
- "我改好了"必须附带：跑的是哪条命令、退出码是什么、输出里的关键行。
- 构建类结论必须来自**真实产物**（`build-info` 的输出、`fingerprint.js check` 的结果），
  不能来自"脚本里写了这个参数"。
- 验证步骤被跳过时必须**显式说出来**，不许静默略过（`dev verify` 会打印 `skip` 并计数）。

**为什么写成铁律**：本项目已经出现过两次"文档/描述承诺了不存在的东西"——
v0.7.0 在 MCP 工具描述里承诺了三个从未被读取的配置项，而同一批修复只处理了其中一项。
这类问题的根因不是粗心，是**把"写了"当成了"做到了"**。

---

## 0. 机制总览（先看这张图）

```
引擎（唯一权威源，零依赖 Node）
   ├─► 独立 CLI（Node / SEA 单文件 exe）：bin/disk-clean.js + lib/
   ├─► MCP server（AI 客户端通用）：bin/disk-clean-mcp.js + lib/mcp/
   │     stdio JSON-RPC 2.0，12 个工具全是 lib/* 的薄封装
   │     任意 MCP 客户端可用：DeepSeek Harness / Claude Desktop / Cursor
   └─► GUI 桌面端（WebView2 原生窗口）：gui/ + lib/serve.js（前端 + HTTP 服务层）
            ├─ C# 壳（WinForms+WebView2，.NET 8 框架依赖单 exe ~24MB，UAC 提权）
            │    spawn engine.exe serve --port <p> --token <t> --web <dir>
            ├─ lib/serve.js：REST 化（仅绑 127.0.0.1 + Bearer 鉴权）
            └─ gui/web/：零依赖暗色仪表盘（主页极简 + 高级 Tab，双语）
                    │
                    ▼
   Inno Setup 安装器（检测 .NET 8 Desktop Runtime / WebView2，缺则引导官方 bootstrapper）
            │
            ▼
   GitHub 仓库（同一仓库承载三侧）→ Release 资产（setup exe + 引擎 exe + SHA256SUMS）→ CI 回归
   npm 包（disk-clean，含 disk-clean / disk-clean-mcp 两个 bin）
```

- **同源铁律**：业务逻辑只写一处（`lib/`）。MCP 工具与 CLI 命令、GUI 服务层都是薄壳，
  不得复制引擎逻辑。若某能力在 CLI 有而 MCP 没有，就在 `lib/mcp/tools.js` 加一个薄封装，
  而不是写第二份实现。
- **安全规则同源**：路径闸门只有 `lib/guard.js` 一处；清理白名单只有 `lib/clean.js` 一处。
  三侧共享，新增受保护路径只改 `guard.js`。
- **版本同源**：只有 `lib/version.js` 的 `VERSION` 可写，其余派生；`test/version-consistency.js` 守门。
- **三条分发线共享同一仓库**：CLI 是第一入口（Release 资产），MCP server 随 npm 包分发，
  GUI 放 `gui/` + `installer/` 随仓库分发。

---

## 1. 新项目启动（骨架）

```
<repo>/
├── bin/            # 入口：disk-clean.js（CLI）+ disk-clean-mcp.js（MCP server）
├── lib/            # 引擎与全部业务逻辑（engine-core.js / guard.js / clean.js / serve.js…）
│   └── mcp/        # MCP：server.js（协议核心）+ tools.js（工具定义）
├── scripts/        # build-sea.ps1（**全 ASCII**，SEA 打包）/ bump-version.js / publish-release.ps1
├── test/           # CI 测试套件（**仓库内相对路径，禁止本机绝对路径**）
├── docs/           # RELEASE-PLAYBOOK.md / OPTIMIZATION-PLAN.md / GUI-PLAN.md
├── skills/         # 可复用技能（SKILL.md）：release-sop / gui-development
├── gui/            # GUI 桌面端：shell/（C# 壳）+ web/（前端）+ stage|publish|dist（构建产物）
├── installer/      # Inno Setup 安装器脚本（disk-clean-ui.iss）
├── .github/workflows/
├── README.md       # Option A 单文件 exe / Option B npm / Option C MCP / Option D GUI
├── CHANGELOG.md
└── package.json / sea-config.json / LICENSE / ROADMAP.md
```

**起步顺序**：`package.json + git init` → 引擎最小可跑 → 安全闸门（guard）+ 版本源（version）
先立起来 → 其余形态都是薄壳 → 首个 Commit 就入库（编码铁律见 §5）。

---

## 2. MCP server 制作 SOP

> 历史教训：本项目曾以 **DSH 专有插件**（`plugin/`，约 3400 行 DSH 专属代码）作为 AI 接入形态。
> 它有三重问题：① 与 CLI 引擎长期"双份改"，是缺陷密度最高的部分；② 出货形态挂的是静态宿主半，
> 而 `harness.*` API 只存在于动态插件求值环境 → **图表面板在出货形态技术不可行**（重写即第五份 UI）；
> ③ 零测试覆盖。v0.5.0 已整体删除，改用标准 MCP 协议接入。**新项目不要在专有插件形态上重复这个错误。**

### 2.1 为什么选 MCP

| 维度 | 专有插件（旧） | MCP server（现） |
|---|---|---|
| 客户端 | 只有 DSH | DSH / Claude Desktop / Cursor / 任何 MCP 客户端 |
| 代码量 | ~3400 行专有代码 + 辅助进程 | ~1200 行（协议核心 ~150 + 工具定义） |
| 与 CLI 同源 | 双份引擎副本，需同步脚本 | 同一 `lib/`，工具是薄封装 |
| 安全模型 | 依赖宿主审批 API | 协议注解 + 默认 dry-run，可独立验证 |
| 可测试性 | 无法测试（需宿主环境） | 纯进程内/子进程测试，见 `test/mcp-protocol.js` |

### 2.2 协议要点（零依赖手写实现）

- **传输**：stdio，**一行一个 JSON-RPC 2.0 对象**（NDJSON）。stdout 只允许协议消息，
  任何诊断输出必须走 stderr —— 这是 MCP server 最容易踩的坑，会直接破坏协议流。
- **方法**：`initialize` / `notifications/initialized`（通知，无响应）/ `ping` /
  `tools/list` / `tools/call`；未实现的能力返回空列表（`resources/list` → `{resources:[]}`）。
- **协议版本**：`2024-11-05`。
- **错误码**：PARSE `-32700` / INVALID_REQUEST `-32600` / METHOD_NOT_FOUND `-32601` /
  INVALID_PARAMS `-32602` / INTERNAL `-32603`。**工具自身的业务失败不是协议错误**：
  返回 `{content:[{type:'text',...}], isError:true}`，让模型读到原因。
- **串行化**：引擎有模块级状态 → `tools/call` 必须**排队串行**执行，
  否则并发扫描互相污染（`lib/mcp/server.js` 的 `queue` Promise 链）。
- **注解**：每个工具带 `annotations: {title, readOnlyHint, destructiveHint, idempotentHint, openWorldHint}`，
  客户端据此决定是否弹确认。`listTools()` 必须透传注解。

### 2.3 工具设计铁律

1. **薄封装**：工具体只做「参数整形 → 调 `lib/*` → 裁剪结果」，不写业务逻辑。
2. **破坏性动作默认 dry-run**，`confirm:true` 才执行；返回里给出回滚指引。
3. **边界必须显式拒绝**，不许静默兜底：路径白名单外、根不可访问、盘符非法，
   一律 `ok:false + error + hint`（下一步动作）。
4. **错误文本要可行动**：`fail(msg, hint)` 统一出口，hint 告诉模型怎么修。
5. **不把内部对象外抛**：只读叶子字段，构造最小自有对象（live 对象不可序列化）。
6. **结果要裁剪**：列表类返回 `slice(0, N)` + `truncated` 标记，避免撑爆上下文。

### 2.4 MCP 验证清单

- [ ] `node --check lib/mcp/*.js bin/disk-clean-mcp.js`
- [ ] `test/mcp-protocol.js`：握手 / ping / tools/list 结构 / 注解透传 / 五个错误码 /
      安全负例（受保护路径、OneDrive、出扫描范围、白名单外）/ 未确认即 dry-run /
      **子进程 stdout 纯净性**（逐行 JSON.parse，非 JSON 行即失败）
- [ ] 手工接入真实客户端（`npx -y disk-clean mcp` 跑一次 tools/list）

---

## 3. CLI 制作 SOP

### 3.1 构建

- `scripts/build-sea.ps1`：`esbuild bundle → node --experimental-sea-config → postject` 全离线；
  **脚本全 ASCII**（CI 用 pwsh7，中文会破坏字符串）。
- 版本号在 `lib/version.js`（单一事实源），`bin/disk-clean.js` 与 `lib/serve.js` 只引用不写死；
  SEA 单入口，子进程自我调用走 `--internal-*` 参数，按 `IS_SEA` 分派脚本路径。
- 依赖：Node 内建 `fs/crypto/child_process` + PowerShell 补齐系统能力（COM 快捷方式 / SMART / 计划任务），
  零运行时依赖。`engines.node >= 18.15`（`fs.statfsSync` 与 `node:sea` 的下限）。

### 3.2 验证清单

- [ ] 本地全量回归（`npm test`，11 个套件）
- [ ] 重打包 exe 后**重新跑全命令**（exe 与源码永远同步）
- [ ] **exe 形态也要过 MCP 端到端**：`node scripts/mcp-e2e.js <测试树> --exe dist\disk-clean-win-x64.exe`
      —— 只测源码会漏掉"源码对、打包后坏"（SEA 把整个依赖树塞进 blob，`require` 行为可能不同）
- [ ] 版本 bump（`node scripts/bump-version.js <from> <to>`，自带一致性自校验）+ CHANGELOG + ROADMAP 同步
- [ ] `node bin/disk-clean.js mcp` 起一次、`tools/list` 正常（MCP 侧不因 CLI 改动而坏）

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
- **前端 token**：`window.__DSK_TOKEN__`（由 C# 壳注入）为唯一主路径；query token
  仅在 `DSK_ALLOW_QUERY_TOKEN=1` 时放开（token 进浏览器历史/Referer/代理日志是真实风险）。

### 3.5.2 服务层（lib/serve.js）铁律

- **只绑 127.0.0.1**；除 `/api/health` 外全部要求 `Authorization: Bearer <token>`
  （query token 默认拒绝，见 §3.5.1）。静态托管越界判定用 `path.relative`，
  **不用 `file.startsWith(webDir)`**——`webDir=C:\app\web` 时 `C:\app\web-evil\x.js` 也会前缀匹配。
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
- **v0.3.2 新增：报告 Tab**（概览 / 清理中心 / 重复文件 / 整理建议）替代长滚动建议区；
  清理中心新增 **stale-large** 一键清理（clean.js validate+serve extract）、
  **一键全清（仅低风险 junk-temp+empty-dirs 合并预览）**；复选框旁**创建系统还原点**（默认勾选，透传 restorePoint:true）。
- **v0.3.2 查重扩展**：扫描期候选 = 用户区 ∪ 扫描根浅层（fallback，`dupScan.wideCandidates`），summary.dupScan 覆盖说明；UI 提示「深层：全盘深度查重」按钮深度调 `/api/dedup`。
- **v0.4.1 补：OneDrive 云同步段不参与查重与破坏性建议**（防哈希触发静默下载），扫描统计保留；UI/report 显著提示条「OneDrive 云端文件不参与查重与清理」。
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
- **正式安装必须显式指定带引号目录**：`/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /DIR="C:\Program Files\disk-clean"`——
  仅靠 `DefaultDirName` 会被 **Inno 的"同 AppId 沿用旧安装目录"** 覆盖（v0.3.1 曾把 E2E 残留
  `%TEMP%\dsk-final-test\app` 当正式安装更新）。先读卸载注册表清理旧残留再装。
- **Start-Process -ArgumentList 含空格参数**：数组传入会按空格拆分（`/DIR=C:\Program Files\...` 断成
  `/DIR=C:\Program`）——传**整体字符串**并在路径外加引号。
- 安装产物校验：静默安装 `/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /NOCANCEL`
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
- [ ] **Edge headless 渲染**：需要 query token 时给引擎进程加 `DSK_ALLOW_QUERY_TOKEN=1`
      （默认拒绝），然后
      `msedge.exe --headless=new --disable-gpu --user-data-dir=<临时> --dump-dom --virtual-time-budget=8000 "http://127.0.0.1:<port>/?token=<t>"`
      → 检查 nav-item / drive-card / 真实容量数字 / 默认选中 D / 无 `Uncaught|ReferenceError|TypeError`
      （旧 `--headless` 模式可能空输出，必须 `--headless=new` + 独立 profile）
- [ ] PS 5.1 调 API 发中文 JSON 用 `[Text.Encoding]::UTF8.GetBytes($json)` 字节体
      （字符串体默认 Latin-1，中文变 `???` 造成假 400）
- [ ] **v0.3.2 报告 Tab**：`rep-tabs`/`ui-kit.js` 随 `gui/web/*` 进入 stage；OneDrive 占位跳过提示条可见；清理中心 4 卡 + 全清低风险（仅 junk-temp/empty-dirs 自动）
- [ ] **v0.4.1 健康趋势**：`health.trend` 字段、`health-history.json` 节流 60s/缓存 30s、health Tab 趋势 sparklines、卷映射表
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

### 安全教训（第三方锐评 A1–A5，v0.5.0 后实测增补）

32. **"抽样判重"绝不能驱动破坏性操作（A1，P0）**：`dedup.js` 对 >32MB 的文件只比对
    head 64KB + tail 64KB 就标 `approx:true`。而 CLI / MCP / GUI **三条路径都不过滤 approx**
    就直接硬链接合并 —— 实测复现：两个 33MB 重名文件（头尾相同、中间不同）被判为重复，
    合并后中段字节从 `17/34` 变成 `17/17`，即**第二个文件的内容永久消失**，
    且 `.dsk-dup-bak` 备份在成功后即删除 → 不可逆。
    修法：在唯一收口 `hardlinkGroup` 内硬性拒绝 approx 组（fail-closed），三个调用方无需各自过滤。
    **推论：凡"抽样/启发式判定"驱动"不可逆动作"的组合，都必须在动作的唯一入口再断言一次。**

33. **安全闸门"单源"必须用 grep 证明（A3）**：README 宣称保护名单已收敛到 `lib/guard.js`，
    实际 `engine-core.js` / `organize.js` / `bin/disk-clean.js` / `serve.js` 还各留一份
    7 段副本（缺 `windows.old/boot/efi/recovery/perflogs/msocache/config.msi/$windows.~bt/~ws`
    共 9 段），且 organize 副本无尾部匹配 —— 同一个 `C:\Users\me\windows` 在清理侧被拒、
    在整理侧放行。**"单源"是可用一条 grep 证伪的声明，发布前跑一次。**

34. **前缀匹配与路径穿越必须一起审（A4/A5）**：`organize.js` 的目标校验只做
    `^[a-z]:\\整理区\\` 前缀正则，`C:\整理区\..\boot\x` 通过后被 OS 解析成 `C:\boot\x`；
    同文件的 `inScanRoots` 又是 `lp.indexOf(root) === 0`（`C:\Users` 命中 `C:\UsersOther`）。
    修法：`path.resolve` 归一化 + 显式拒绝 `.`/`..` 段 + 断言归一化后父目录就是 `<盘>:\整理区`。
    **同文件里"早就修好的那个 bug"常常在隔壁函数里原样活着。**

35. **测试没覆盖的边界等于没有边界**：A1 自 v0.4.0 起就在仓库里，
    10 个套件全绿——因为**没有任何用例碰过硬链接的安全边界**。
    新增 `test/safety-gates.js` 专门守 A1–A6，其中 A1 用真实 >32MB 文件对做端到端可达性证明
    （先断言扫描确实判为 approx，再断言合并被拒绝），而非只喂合成对象。

### 4.3 Release 资产

```
disk-clean-setup-<ver>.exe   （GUI 安装器 ~26MB，LZMA2 压缩；gh release create 上传超时 → 后台任务跑）
disk-clean-setup-<ver>.exe.sha256
disk-clean-win-x64.exe   （CLI/引擎 SEA，~82MB，同上后台上传）
disk-clean-win-x64.exe.sha256
SHA256SUMS.txt          （含引擎 + 安装器两项校验和）
checksums.txt           （含两项 sha256/size/version/**commit** 行，发布时由 publish-release.ps1 重算）
```

- **这一份清单是声明式的**：`disk-clean.config.json` 的 `release.assets` 是唯一事实源，
  `publish-release.ps1` 与 `dev.js verify` 都读它。仓库名、包名、资产名不得再散落成字面量
  （实测曾出现 `disk-clean-win-x64` ×29、`disk-clean-setup` ×17）。
  校验和文件自 2026-09-12 起多带一个 `commit=` 字段，于是**光看发布页就能知道产物来自哪个提交**。
- **发布前产物核对铁律**：`Get-FileHash` 与 Release 资产 digest 一致才算发布成功；
  `dist/` 被 .gitignore 忽略，SHA256SUMS 只作 Release 资产不入库，**每次构建后必须重算**。
- **checksums.txt 必须由发布脚本重写并上传（G53）**：CI 曾用它自己的 SEA 产物创建 Release 并上传
  checksums.txt，而 `publish-release.ps1` 随后把 exe 覆盖成本地构建——若不重写这个文件，
  Release 上就会留下一个"哈希属于已不存在的构建"的 checksums.txt。
  v0.5.0 实际发生过：release 资产写着 `sha256=72ce9f21…`，而 exe 是 `3cbdc188…`。
  现已重算、上传，并**回到 API 下载内容断言哈希一致**（只比 size 抓不到这个）。
- **制品指纹断言（S9）**：上传前跑 `scripts/fingerprint.js check`，要求 exe 自述的 commit
  等于 HEAD、且构建时树是干净的。它拦住的是"先构建、再改代码、再发布"——
  那种情况下版本号一致、哈希自洽、下载回验也通过，但用户拿到的 exe 里没有最后那次修改。
- 上传一律后台任务 + `--clobber` 覆盖；**上传期间不要重建源文件**（会破坏半传文件），
  需重传先 kill 上传 job 再重建再传。
- Release 必须**非 draft**；CI workflow 手动验证（`gh workflow run` 在 CI 修复后重新触发，不删 tag 重推）。
- 遗留 draft 删除：`gh release delete` 偶发静默失败（exit 0 未删）——用 API
  `DELETE /repos/{owner}/{repo}/releases/{id}` 兜底（返回 204）。

### 4.4 CI 铁律

- 测试代码**禁止本机绝对路径**（CI 目录 `D:\a\...`），用仓库内相对路径 + 运行时自建测试树。
- 语法检查覆盖**全部** bin/lib/*.js（不只 4 个核心）。
- **CI 不创建 Release（2026-09-12 起）**。此前 `push tags: v*` 会走 `softprops/action-gh-release`
  自动发布一个未获批、且只有引擎（没有 GUI 安装器）的半成品 Release——
  等于 `git push --tags` 就能绕过审批门禁。**一个可以被 `git push` 绕过的门禁不是门禁。**
  现在 CI 只构建、断言指纹、上传 workflow artifact；job 的 `permissions` 相应降到 `contents: read`。
  发布只能由 `scripts/publish-release.ps1` 完成。
- `npm ci` 排在测试**之前**：产品测试是零依赖的，但 `test/build-fingerprint.js` 必须真的打包一次
  才能证明指纹注入生效（只断言"脚本里写了 --define"抓不到写错的 flag 名）。

### 4.5 发布检查清单

按顺序，任一步失败即停止：

- [ ] `node scripts/dev.js doctor` 全绿（token / 代理 / 工具链 / 审批目录）
- [ ] `node scripts/dev.js verify` 全绿（**跳过项要数清楚，跳过的步骤不算证据**）
- [ ] `git status` 干净、`git log` 与 `ls-remote origin master` 一致
- [ ] 版本号已 bump 且 `test/version-consistency.js` 通过（9 个源）
- [ ] `docs/RELEASE_NOTES-v<ver>.md` 与 `docs/release-guide-v<ver>.md` 都已写
      （缺任一个，`publish-release.ps1` 会直接拒绝）
- [ ] 两侧产物已构建：`build-sea.ps1` → `build-installer.ps1`（顺序不可颠倒）
- [ ] `node scripts/fingerprint.js check --require-clean-worktree` 通过
- [ ] **人已批准**：`node scripts/approval.js confirm --version <ver> --by "<名字>"`
- [ ] `publish-release.ps1 <ver> -PublishNpm` 跑完且末尾打印 `Publish verified`
- [ ] Release 非 draft、6 个资产齐全、哈希与本地一致（脚本内部已回下载校验）
- [ ] 下载 exe 后 `build-info` 的 commit == 本次 tag 指向的 commit
- [ ] CI 最新 run 成功
- [ ] README（Option A/B/C/D 链接）+ CHANGELOG + ROADMAP 无坏链接
      （其中文档与实现的一致性已由 `test/docs-consistency.js` 自动守住，不必人工 grep）

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
16. **版本 bump 必须用 Node 脚本**（`scripts/bump-version.js <from> <to>`）：PS 5.1 管道 `Get-Content -Raw` 不带 `-Encoding UTF8` 按 GBK 读→ `Set-Content -Encoding UTF8` 写 BOM+乱码（G46 专项）；附带 `verLabel` 在 `index.html` 的正则回退。
17. **git checkout 去污前必 `git diff <file>` 盘点**（G47）：`checkout -- <file>` 是整文件回退，会把未提交的好改动一并抹掉；用产物内容验证（grep rep-tabs）。
18. **`push.ps1` 误报 G50**：`--quiet` 下 `2>&1` 合并让 PS5.1 把 git stderr 转 ErrorRecord 而误判成功——改为 stderr 重定向到临时文件 + API 兜底（`ls-remote` 两通道 + GH API）。
19. **`publish-release.ps1` G48/G49**：`((git tag -l $tag) | Out-String).Trim()` 兼容 null；`$ErrorActionPreference='Continue'` + `$LASTEXITCODE` 判成功。
20. **OneDrive 云同步段需显式排除**：查重哈希会触发占位文件静默下载；扫描统计保留但 `bySize/wide` 及破坏性建议项过滤 `\onedrive\` 段，UI/report 显著提示条「不参与查重与清理」。

---

## 6. 新会话复用指南（回答"新开会话还能不能用"）

**对话记忆不会带到新会话，但流程载体可以——用以下任一方式让新会话复用：**

1. **技能（推荐）**：`skills/release-sop/SKILL.md`（发布流程）与
   `skills/gui-development/SKILL.md`（GUI 桌面端专项）已安装为**全局技能**
   （`~/.agents/skills/`），新会话自动可见；对模型说"按 release-sop 流程做 XXX"
   或"按 gui-development 做 GUI"，即加载对应速查。
2. **仓库文档**：直接要求模型读 `docs/RELEASE-PLAYBOOK.md`（本文件）+
   `docs/OPTIMIZATION-PLAN.md`（演进计划与已修缺陷）+ `docs/GUI-PLAN.md`（GUI 设计），命令示例：
   ```
   读取 D:\deepseekHerness\disk-clean-cli\docs\RELEASE-PLAYBOOK.md 和 OPTIMIZATION-PLAN.md，
   按 §2 MCP SOP 给 disk-clean 加一个新工具，并走 §4 发布流程。
   读取 D:\deepseekHerness\disk-clean-cli\docs\GUI-PLAN.md 与技能 gui-development，
   按 §3.5 GUI SOP 修改前端/安装器。
   ```
3. **技能 = 指针，手册 = 权威**：SKILL.md 只放速查与定位（"读哪些文件、按哪几节做"），
   完整内容始终以仓库 docs/ 为准，避免两份文档漂移。
4. **MCP 形态让新会话直接可用**：任何 MCP 客户端接上 `disk-clean mcp` 就能拿到 12 个工具，
   不依赖会话记忆，也不需要在本仓库里挂载任何插件代码。

> 最佳实践：新会话开头先让它读本手册 + OPTIMIZATION-PLAN，再开始动工；编码铁律（§5）每题必查。

### MCP 形态增补（v0.5.0）

21. **stdout 是协议通道**：MCP server 任何非协议输出（`console.log`、警告、进度）都会破坏
    JSON-RPC 流。诊断一律 `process.stderr.write`；`test/mcp-protocol.js` 以"逐行 JSON.parse"守门。
22. **`tools/call` 必须串行**：引擎有模块级状态，并发调用互相污染；用 Promise 链排队。
23. **业务失败 ≠ 协议错误**：工具返回 `isError:true` + 可读原因，不要抛 JSON-RPC error
    （那会让模型只看到"内部错误"，不知道该怎么修）。协议错误只留给解析/方法/参数层面的失败。
24. **破坏性工具默认 dry-run**：AI 会直接照返回值复述结论，所以"0 项执行成功"绝不能返回
    `ok:true`（否则模型会宣布"清理完成"）。同类：清空回收站必须回报真实条目数并标注不可恢复。
25. **边界拒绝要带 hint**：路径闸门拒绝时同时给出"下一步怎么办"，否则模型会反复重试同一调用。

### 路径归一化与发布脚本（v0.5.0 实测增补）

26. **跨来源路径比较必须归一化，不能纯字符串比**（G52）：
    审计日志记的是调用方原样给的路径，回收站 `$I` 记录是系统写的规范路径，两者拼写经常不同——
    最常见的是 8.3 短名（`ADMINI~1` vs `Administrator`），还有 junction/映射盘、尾分隔符、大小写、`.`/`..`。
    实测：本机 `%TEMP%` 就是短名形式，导致"清理 3 项后 `toolMatched=0`"，
    即**刚清理完的文件无法恢复**——安全功能静默失效。
    正确做法（`canonKey`）：`path.resolve` → 对**最深的仍存在的祖先**做 `realpath` → 把缺失尾段拼回 → 小写去尾分隔符。
    ⚠ 只 realpath 直接父目录是不够的：清理后父目录已不存在，两边会各留各的拼写而继续失配。
27. **发布脚本每一步都要复核真实状态，禁止假成功**（G51）：
    旧 `publish-release.ps1` 在 release 创建返回 403、资产上传报 "release not found" 的情况下，
    仍然打印 `Publish verified: v0.5.0` 并 `exit 0`。根因是 `$ErrorActionPreference='Continue'`
    （为压 native stderr 噪音而设）让失败不中断，且 `if ($r.draft)` 在 `$r` 为 `$null` 时被跳过。
    现在：每步显式判返回码，关键步骤**回到 API 复核**（Release 是否存在、非 draft、资产名齐全、远端字节数 == 本地），
    下载回来比对哈希，任一失败立即 `exit 1` 并给出可行动的修复指引。**发布类脚本不得只信 `$LASTEXITCODE`。**
28. **`.ps1` 全 ASCII 是硬约束，不是风格偏好**（G46 复发）：
    本轮把 `publish-release.ps1` 的提示信息写成中文，`write` 工具落盘为无 BOM UTF-8，
    PS 5.1 按 GBK 读取 → 中文变乱码 → **解析错误**（`Unexpected token '鍒涘缓'`）。
    改动任何 `.ps1` 后必须验证：`非 ASCII 字节数 == 0` 且 `Parser::ParseFile` 无错。
    需要中文说明就写在 `docs/`，脚本里只留英文。

### 权限与凭据

29. **fine-grained PAT 必须给 `Contents: Read and write`**：只给读权限时，
    `gh release create` 返回 `403 Resource not accessible by personal access token`，
    而 `git push`（走 git 协议）可能仍然可用——于是出现"代码推上去了、Release 发不出来"的迷惑状态。
    发布前先跑 `scripts/publish-release.ps1` 的第 0 步预检，它会直接告诉你要补哪个权限。
30. **token 泄露后必须轮换**：一旦 PAT 出现在对话记录、日志或提交里，立即到
    Settings → Developer settings → Fine-grained tokens 撤销重建（撤销即时生效，代价只是重配一次）。
36. **npm 渠道要单独核对，别信文档**（2026-09-11 实测）：本项目文档一度写着"npm 首发未执行"，
    实际 `disk-clean@0.4.1` 自 2026-08-25 起就是 `dist-tags.latest`，且**含当时已修的全部 P0/A2/A3**
    （`hardlinkGroup` 不查 `approx`、不调 `guard`，无 `lib/guard.js`、无 `lib/mcp/tools.js`）。
    核对手法：`Invoke-RestMethod https://registry.npmjs.org/<pkg>` 看 `dist-tags`，
    必要时下载 tarball 实检（`registry.npmjs.org/<pkg>/-/<pkg>-<ver>.tgz`）。
    **推论：发布渠道的状态必须逐条实证，"我记得没发过"不算。**
    （已于同日 0.6.0 发布修正；发布后同样要**实测** `dist-tags` 与真实命令，
    `npx -y disk-clean mcp` 通过才算 npm 这一侧真的可用。）
38. **能认证 + 能读 + 不能写 = 权限问题，不是凭据问题**（npm 403 排查法）：
    `npm whoami` 与 `npm owner ls` 都成功、`npm publish` 却返回
    `E403 You may not perform that action with these credentials`，
    说明 token 有效但缺发布权限，去 **Packages and scopes → Permissions** 查：
    必须是 **`Read and write (publish and stage)`**；`Read-only`、`No access`、
    **以及 `Read and write (stage only)`** 在直接发布时给出的 403 **症状完全一样**，
    容易误判成别的原因。另：token 创建页的 **Organizations** 区块
    **只管组织成员/团队设置、明确不授予发包权限**，应设为 `No access`——
    把它设成别的值会弹"必须选择一个组织"，与发包毫无关系。
    存放建议：token 放环境变量，`~/.npmrc` 写 `_authToken=${NPM_TOKEN}`，不落明文文件。
39. **`npm publish` 的规范化警告要清干净**：`bin` 路径写 `./x.js` 与 `repository.url`
    缺 `git+` 前缀都会让 npm 在每次发布时打印 `was cleaned` / `was normalized`
    （`bin` 那条连官方文档示例都会触发，见 npm/cli#7302）。
    交付判据：`npm publish --dry-run` **零 warn** —— 发布的清单与测过的清单一致。
37. **`push.ps1` 的"假成功"会让回退永不执行**（G55）：代理上的 `git push` 实际没推上去，
    脚本却打印 `Push succeeded`，于是 **direct 回退分支从未运行**（它只在返回码非 0 时才走），
    只有第 2 步校验发现了异常。两个成因：① 未在调用前清空 `$LASTEXITCODE`——
    git 进程若根本没启动，PowerShell 会**保留上一次的值（常常是 0）**，失败读成成功；
    ② 用返回码单独判定成功。修法：调用前置 `$global:LASTEXITCODE = $null`、null 视为失败，
    且**代理尝试必须先通过 local==remote 校验才算成功**，否则落入直连分支。
    排查用：`git -c http.proxy= -c https.proxy= push origin master`（绕过代理直连）。

### 发布脚本的宿主差异（v0.5.0 实测增补）

31. **`Invoke-WebRequest -UseBasicParsing` 的 `.Content` 在 PS 5.1 下是 `Byte[]`，不是 `String`（G54）**：
    `scripts\*.ps1` 是以 `powershell -File`（**PowerShell 5.1**）运行的，而 pwsh7 会返回 String——
    于是"在 pwsh 里手测通过"的字符串比较逻辑，进了脚本就 100% 判错。
    本次给 `publish-release.ps1` 加"下载 checksums.txt 并断言哈希"时踩到：资产完全正确，
    却报 `remote checksums.txt does not mention the published engine hash`。
    正确写法（脚本内已有）：
    ```powershell
    $t = (Invoke-WebRequest $url -Headers @{ 'User-Agent' = 'dsh' } -TimeoutSec 60 -UseBasicParsing).Content
    if ($t -is [byte[]]) { $t = [System.Text.Encoding]::UTF8.GetString($t) }
    $t = [string]$t
    ```
    推论：**凡是要把响应体当文本比较/正则的地方，都必须显式解码**；
    并且这类改动必须在 **PS 5.1 宿主**上跑一次（`powershell -File <临时脚本>`），不能只在 pwsh 里验。
    （同族：铁律 26「本地成功 ≠ CI 成功」、第 14 条 PS 5.1 解析差异、第 15 条 Latin-1 请求体。）