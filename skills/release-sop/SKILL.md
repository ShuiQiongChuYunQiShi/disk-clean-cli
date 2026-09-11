# release-sop —— disk-clean 制作与发布流程（可复用 SOP）

## 定位（何时加载）

用户要求：做/改 CLI、做/改 **MCP server**、做/改 **GUI 桌面端**、上传 GitHub、发 npm、
打包发布、或问"这套机制怎么复用/新会话还能不能用"时加载。
本技能 = **速查 + 指针**；完整权威流程在仓库文档 `docs/RELEASE-PLAYBOOK.md`（SOP）与
`docs/OPTIMIZATION-PLAN.md`（演进计划/已修缺陷）以及 `docs/GUI-PLAN.md`（GUI 设计），
永远以仓库为准，勿在本文件复制长内容造成漂移。GUI 专项细节另见 `skills/gui-development/SKILL.md`。

## 第一步：先读权威文档

```text
读取 D:\deepseekHerness\disk-clean-cli\docs\RELEASE-PLAYBOOK.md（仓库权威版）
以及 docs\OPTIMIZATION-PLAN.md（演进计划/已修缺陷）和 docs\GUI-PLAN.md（GUI 设计/验收点）
```

仓库路径：`D:\deepseekHerness\disk-clean-cli\`（GitHub: ShuiQiongChuYunQiShi/disk-clean-cli，master）。
npm 包：`disk-clean`（两个 bin：`disk-clean` 与 `disk-clean-mcp`）。

## 四环节速查

### A. MCP server（AI 接入，v0.5.0 起）
- `lib/mcp/server.js`（协议核心，零依赖，stdio NDJSON）+ `lib/mcp/tools.js`（12 个工具，全是 `lib/*` 薄封装）；
  入口 `bin/disk-clean-mcp.js`，CLI 侧 `disk-clean mcp` 也起同一个 server。
- **stdout 只允许协议消息**：任何诊断走 stderr，否则破坏 JSON-RPC 流（`test/mcp-protocol.js` 守门）。
- **`tools/call` 必须串行**（引擎有模块级状态）；业务失败返回 `isError:true` 而非 JSON-RPC error。
- **破坏性工具默认 dry-run**，`confirm:true` 才执行；拒绝时给 `fail(msg, hint)` 可行动提示。
- 客户端配置：`{ "mcpServers": { "disk-clean": { "command": "npx", "args": ["-y","disk-clean","mcp"] } } }`。
- 历史教训：**不要回到 DSH 专有插件形态**（~3400 行专有代码、与 CLI 双份引擎、
  出货形态下 `harness.*` 不可用导致面板技术不可行、零测试）。v0.5.0 已整体删除。

### B. CLI
- `bin/disk-clean.js` + `lib/` 引擎 + `scripts/build-sea.ps1`（**全 ASCII**，SEA 打包）。
- 版本源唯一：`lib/version.js` 的 `VERSION`，bin/serve 只引用不写死；bump 用
  `node scripts/bump-version.js <from> <to>`（自带一致性自校验）。
- 子进程自我调用 `--internal-*`，按 IS_SEA 分派；零运行时依赖（Node 内建 + PowerShell 补齐）。
- `engines.node >= 18.15`（`fs.statfsSync` 与 `node:sea` 的下限）。
- 版本 bump → 重打包 → **全命令回归**（`npm test`，7 套件）→ commit（exe 与源码同步）。

### C. GitHub 上传
- 认证：fine-grained PAT 用 `$env:GH_TOKEN`（`gh auth login --with-token` 报 401）；
  token 不能建仓库时列出选项让用户选，不卡住。
- 提交：英文 message；本地全量回归 → bump → commit → tag → Release 说明 → SHA256，GitHub 只搬运。
- 82MB exe 上传用**后台任务**（gh release create 会超时）。

### D. 打包发布
- 资产：`disk-clean-setup-<ver>.exe`（GUI 安装器）+ `disk-clean-win-x64.exe`（引擎）+
  `*exe.sha256` + `SHA256SUMS.txt`（含两项校验和，**每次构建后重算**）。
- Release **非 draft**；哈希核对（Get-FileHash 与资产 digest 一致）；CI 最新 run 成功。
- CI：`npm ci` 装依赖；测试禁止本机绝对路径；语法检查覆盖全部 bin/lib/*.js；
  修复后 `gh workflow run` 重触发，不删 tag；workflow 顶层 `permissions: contents: read`。
- 上传 26MB/82MB 大文件用**后台任务 + --clobber**；上传期间不动源文件。
- 遗留 draft 删除用 API `DELETE /releases/{id}` 兜底（gh delete 偶发静默失败）。
- npm 发布：`npm publish`（`prepublishOnly` 自动跑全量测试）；OTP 需用户手动，脚本只做版本/构建校验。

### E. GUI 桌面端（WebView2，v0.3.0 新增；细节见 gui-development 技能）
- 三进程：C# 壳（提权+spawn 引擎+WebView2）→ `engine.exe serve --port <p> --token <t> --web <dir>` → 前端加载 127.0.0.1。
- **CLI 位置参数坑**：spawn 传 `serve` 不是 `--serve`（flag → cmd=undefined → 打印 help 退 0）。
- serve 层：仅绑 127.0.0.1 + Bearer 鉴权（health 除外）；clean 空路径自动提取候选（宁拒勿删）。
- 前端零依赖暗色仪表盘：主页 + 高级 Tab，双语 i18n（localStorage），token 由 C# 壳注入
  （query token 默认拒绝，仅 `DSK_ALLOW_QUERY_TOKEN=1` 放开）。
- 静态托管越界判定用 `path.relative`，**不用 `file.startsWith(webDir)`**（同名前缀兄弟目录会误判放行）。
- 安装器：框架依赖 + 缺则引导 bootstrapper；检测用文件夹探测（FindFirst 8.0.*）而非注册表。
- 构建顺序铁律：改 serve.js → 重建 SEA → 再组装安装器；`scripts/build-installer.ps1` 固化全链。
- 验证链：API 冒烟 → Edge headless=`--headless=new --user-data-dir`（旧模式空输出）→ 静默安装 → GitHub 下载 sha 校验 → 启动 → 健康 → 页面 200。
- v0.3.1 增补：
  - **盘符容量唯一解 = `fs.statfsSync`**（`total/free/avail/used`）；`statSync(root).blocks` 是根目录自身块数（24kb 事故），禁。
  - **范围型操作铁律**：扫描/去重缺省 roots 只回退最近报告 `summary.roots`，绝不静默全盘；前端默认只选 D + 记忆 + 扫描前范围确认弹窗 + 报告回显范围。
  - **图标三处接入**：`scripts/make-icon.ps1`（构建链 step 0）→ csproj ApplicationIcon / iss SetupIconFile / web favicon.svg。
  - **PS 5.1 构造调用单行或 `::new()` + 脚本全 ASCII 注释**（New-Object 跨行解析失败；UTF-8 中文注释被 ANSI 错读）。
  - PS 调 API 发中文 JSON 用 `UTF8.GetBytes($json)` 字节体（字符串体 Latin-1 中文变 `???` 假 400）。
  - `dist/SHA256SUMS.txt` 是**发布时手工组装**（build-sea 只写 `dist/checksums.txt` + `exe.sha256`），发布前重算。
  - 数据正确性三重断言：`roots==所选`、`totalBytes ≤ 卷容量`、`categorySum==totalBytes`（0 差）。

## 编码与 PowerShell 铁律（每题必查）

1. UTF-8 **无 BOM** 写文件（PS 5.1 `-Encoding UTF8` 写 BOM + 按 ANSI 读入 → 中文必坏）。
2. 跨进程输出严格 UTF-8 解码失败回退 GBK。
3. 脚本文件全 ASCII（CI pwsh7 下中文破坏字符串）。
4. 多行 PS 写 .ps1 + `-File`；`cmd /c` 整体包裹引号；**PS 5.1 无 `&&`、无三元 `? :`**（用分号/if-else）；
   Node 路径先存变量再 `&`；含引号/反斜杠的 JSON 参数写文件传参。
5. 硬链接：合并用 PowerShell New-Item 创建、失败回滚；**回滚必须原子序列**
   （rename 到 `.dsk-unlink-bak` → 从保留副本 copyFileSync → 校验大小 → 删备份），
   禁止 `readFileSync` 整文件读入内存 + 禁止"先 unlink 再 write"。
6. C#/GUI 增补：日志读 `-Encoding UTF8`；C# 引擎重定向 `StandardOutputEncoding=UTF8`；
   PS 5.1 `ProcessStartInfo` 无 `ArgumentList`（用 `Arguments` 字符串 + `\"` 包裹路径）。
7. **安全闸门单源**：受保护路径 / OneDrive 判定只在 `lib/guard.js`；清理白名单只在
   `lib/clean.js`。新增受保护段只改 guard.js，三侧（CLI/MCP/GUI）同时生效。
8. **拒绝要带下一步**：所有边界拒绝返回 `ok:false + error + hint`（hint 说明怎么修）。
   MCP 场景尤其重要——模型会把 error 当作指令读。

## 快速检查清单（发布前）

- [ ] git status 干净，ls-remote 与本地一致
- [ ] `node --check` 全过（`npm run check` 覆盖 bin/lib/gui-web 全部模块）
- [ ] 全量测试 10/10：`npm test`（engine-smoke / engine-edge / clean-safety / organize-safety /
      serve-integration / **mcp-protocol** / **dsh-config** / **rules-integrity** / **version-consistency** / **ci-workflow**）
- [ ] Release 非 draft、哈希一致（GUI setup + 引擎两处）、CI 绿
- [ ] README Option A/B/C/D 链接有效（勿用 `../README.md` 仓库外链接）
- [ ] 版本一致性由 `test/version-consistency.js` 自动守住（7 个版本源），无需人工 grep
- [ ] MCP：`node bin/disk-clean-mcp.js` 起一次，`tools/list` 返回 12 个工具
- [ ] GUI：serve 层 API 全冒烟、headless 渲染零 JS 错误、静默安装 + GitHub 下载校验通过