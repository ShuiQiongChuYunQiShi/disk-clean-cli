# Changelog

> **补记说明（v0.7.0）**：本文件此前在 v0.1.0 与 v0.4.0 之间**缺少 0.2.0 / 0.3.0 / 0.3.1
> 三个版本条目**（只有 tag 与 GitHub Release）。这三条于 v0.7.0 补写，**已按倒序放在
> 0.1.0 之前**；依据是 `git log <prev>..<tag>` 的真实提交、当年的 GitHub Release 正文，
> 以及 `docs/RELEASE_NOTES-v0.2.0.md` —— 不凭印象编造，无据可依的内容一律不写。
>
> 另注：npm 渠道曾在 2026-08-25 → 2026-09-11 期间停留在 **0.4.1**（含 v0.6.0 修复的 P0、
> 且没有 MCP server）。**0.6.0 已于 2026-09-11 发布到 npm**，`dist-tags.latest` 已更新，
> `npx -y disk-clean mcp` 亦经端到端验证可用。

## [0.7.0] - 2026-09-11

> 主题：**质量周**——不做新功能，清除"工具在骗你"的三类问题（假承诺 / 口径不一 / 夸大数字）。
> 详见 `docs/RELEASE_NOTES-v0.7.0.md` 与 `docs/PLAN-v0.7.md`。

### Changed
- **`dedup rollback` 现在需要 `--yes`**（唯一行为变更）：此前无条件执行，而
  `organize rollback` 与 MCP 的 `disk_dedup cmd=rollback` 都要求确认——同一动作三种确认模型。
  现统一：无 `--yes` 只预览（列出将还原的项与预计重新占用空间）。
- `clean` 的 dry-run **现在列出将处理的路径**（此前只说数量，用户无从判断；MCP 侧一直是返回清单的）。
- `clean` 的类型提示补上 `stale-large`。

### Removed
- **`config.blacklist`**：该字段从未被任何引擎代码读取，却在 MCP 工具描述里被承诺为
  "强制清理候选"——等于对调用方（尤其 AI）的假承诺。按本仓库"要么实现、要么从描述里删掉"
  的原则删除，并同步 README 命令表与 `ROADMAP.md`（标注"从未实现"）。

### Fixed
- **`retention.auditLines` 不再失效**：此前 `lib/audit.js` 把上限硬编码为 2000，
  配置里的 5000 写了没人读。现惰性读取配置（改完立即生效），非法值回落 2000。
- **CLI 缺 `stale-large` 分支**：MCP 的 `disk_clean` 一直支持，CLI 却会报"未知清理类型"。
- **跨盘移动的"双份副本"不再隐身**：复制成功但删除源失败时，会留下两份副本，
  而重试被 `COPYFILE_EXCL` 卡成 `EEXIST`，用户只看到一条 fail。现显式识别并上报
  "已复制但源未删除"，附两份路径，审计标记 `partial`，MCP/GUI 拿到独立的 `duplicated` 列表。

### Added
- **`disk-clean drives`**：列出本地盘符与真实容量（总/已用/可用/使用率）。
  实现前先做了**单源化**——查代码发现该能力已有两份实现（`lib/mcp/tools.js` 与 `lib/serve.js`
  各算一遍 `statfsSync`），若再加第三份就是重犯 A3。故抽出 `lib/drives.js` 作为唯一事实源。
- `test/cli-and-config.js`（套件 11 → **12**），7 组断言专守本版各项。

### Performance
- **硬链接合并不再使用 PowerShell**：原实现对每个 victim `spawnSync` 一次（实测 144ms/个，
  1000 个约 2.4 分钟）。实测 Node 内建 `fs.linkSync` 直接可用（同 inode/nlink=2/共享数据），
  **0.66ms/个 → 1000 个约 0.7 秒（218x）**。保留 PowerShell 回退以免极少数环境回归。
- **`dedup` 的文件 `stat` 改为并发**（复用既有 `pool`，并发 16）：1 万文件基准
  stat 阶段 292ms → 71ms，整体 772ms → 540ms；外推 40 万文件约省 9 秒。
- 注：锐评原估"上千重复文件需 30–50 分钟"**实为约 2.4 分钟（夸大 ~15 倍）**，
  本版据此重排了优先级（见 `docs/PLAN-v0.7.md` §1.0）。

### Docs
- CHANGELOG 补齐 **0.2.0 / 0.3.0 / 0.3.1** 三个版本条目（依据真实提交与当年 Release 正文重写，
  不凭印象编造），并整理为严格倒序。
- `lib/mcp/server.js` 的 GBK 编码疑虑（锐评标注为*推测*）经实测**未复现**，
  结论写入代码注释，以免后人重复排查。

## [0.6.0] - 2026-09-11

> 主题：**安全加固**。一次第三方锐评对 v0.5.0 提出 1 个 P0 与 5 个安全/正确性缺陷，
> 全部复现后修复；不新增功能。

### Security
- **硬链接合并不再接受"仅头尾抽样"的近似重复组**（P0，评审 A1）：`dedup.js` 对 >32MB 的文件
  只比对 head 64KB + tail 64KB 就标 `approx:true`，而 CLI、MCP、GUI **三条路径都不过滤该标志**
  就直接合并为硬链接。实测复现：两个 33MB 文件（头尾相同、中间不同）被判为重复，合并后中段字节
  由 `17/34` 变为 `17/17` —— 第二个文件内容永久消失，且 `.dsk-dup-bak` 备份在成功后即删除，**不可逆**。
  现于唯一收口 `hardlinkGroup()` 内硬性拒绝 approx 组（fail-closed），三个调用方无需各自过滤；
  MCP 侧显式分流并给出"改用 `disk_clean duplicates`（移入回收站，可恢复）"的可行动提示。
- **硬链接合并/serve/CLI 的路径写入现在都过统一安全闸门**（评审 A2）：`hardlinkGroup()` 此前全程
  不调 `guard`；同时 `dedup.scan()` 对扫描根传 `segs=[]`、不校验根自身，于是
  `roots=['C:\\Windows\\System32\\drivers']` 会放行并开始哈希系统文件。现根自身先过
  `guard.isProtectedPath`（命中记入 `skippedRoots`，不静默），每个 keep/victim 也逐一过闸门。
- **保护名单收敛为真正单源**（评审 A3）：`README` 宣称已收敛到 `lib/guard.js`，实际
  `engine-core.js`（`DANGER`）、`organize.js`（`SYS_PREFIX`）、`bin/disk-clean.js`（正则）、
  `serve.js`（`SYS_RE`）各自还留一份 **7 段**副本，缺 `windows.old` / `boot` / `efi` / `recovery` /
  `perflogs` / `msocache` / `config.msi` / `$windows.~bt` / `$windows.~ws` 共 **9 段**；
  且 organize 副本无 guard 的尾部匹配，导致同一个 `C:\Users\me\windows` 在清理侧被拒、在整理侧放行。
  现四处全部改为 `require('./guard.js')`，源码内保护名单只剩一处定义。
- **整理目标不再允许路径穿越**（评审 A4）：`organize.js` 此前只做 `^[a-z]:\\整理区\\` 前缀正则，
  `C:\整理区\..\boot\x` 可通过并被 OS 解析为 `C:\boot\x`（管理员会话下真的会移进受保护目录）。
  新增 `guard.checkOrganizeDest()`：归一化 + 显式拒绝 `.`/`..` 段 + 断言归一化后仍位于 `<盘>:\整理区\<分类>`。
  `engine-core.js` 的第二道拦截也改用 `guard.isProtectedPath`（补尾部匹配与 16 段）。
- **`organize` 不再自写带边界 bug 的扫描根匹配**（评审 A5）：`lp.indexOf(root) === 0` 会让
  `C:\UsersOther` 命中 `C:\Users`；现统一走 `guard.inRoots`。

### Fixed
- **`dedup-map.json` 收敛为单一 schema**（评审 A6）：MCP 写 `{entries:[{victim,keep,size,at}]}`，
  而 CLI 与 GUI 写 `{merged:[path]}`，读取端各读各的 —— 结果是"AI 合并的文件，GUI/CLI 回滚不了"
  （读到空的 `merged` 后报"没有可回滚记录"）。现读写只在 `lib/dedup.js` 一处（`readDedupMap` /
  `writeDedupMap` / `appendDedupEntries`），一律写 `entries`、兼容读旧 `merged`；
  回滚改为 append-only（失败项保留记录供重试），不再整文件删除映射。
- **回收站匹配统一走 `canonKey`**（评审 A7）：`tools.js` 早已用 `canonKey` 修掉 8.3 短名失配，
  而 `serve.js` 仍用裸 `toLowerCase()` 比较 —— GUI 的"回收站恢复"列不出自己刚清理的项。
  现 `canonKey` 上移到 `lib/guard.js` 单源，`tools.js` 与 `serve.js` 共用同一实现
  （`tools.js` 保留同名导出以免破坏既有调用）。
- **部分成功不再伪装成成功**（评审 B4）：`clean.execute` 在 `$ErrorActionPreference="Continue"`
  下会静默跳过被占用/权限不足的项，`3/5` 也返回 `ok:true`，AI 只读 `ok` 便会宣布"清理完成"。
  现返回 `partial:true` 并在措辞里写明"其余 N 项失败，未全部完成"；MCP 层对该情形上报
  `isError:true`，确保模型不会照 `ok` 复述结论。
- **回滚映射改为原子写**（评审 B3）：`organize-map.json` / 快捷方式记录此前用裸 `writeFileSync`，
  进程在写入中途被杀会留下半截 JSON —— 读取端一律把解析失败 catch 成"空数组"，
  于是回滚记录静默消失、已移动的文件再也回不来。现新增 `writeFileAtomic()`（临时文件 + 同目录 rename）。
- **畸形 URL 转义不再打崩服务层**（评审 B6）：`serveStatic` 里 `decodeURIComponent` 遇到
  `/%`、`%zz` 会抛 `URIError` 且无人捕获；现捕获后返回 400。
- **发布产物不再被写成"哈希属于已不存在的构建"**（G53）：CI 在 tag 推送时用它自己的 SEA 产物
  创建 Release 并上传 `checksums.txt`，而 `publish-release.ps1` 随后把 exe 覆盖成本地构建——
  旧的 `checksums.txt` 因此留在了 Release 上。v0.5.0 实际发生过：资产写着
  `sha256=72ce9f21…`，而 exe 是 `3cbdc188…`。现第 3 步重算该文件并纳入上传清单，
  第 4 步**下载回来断言哈希**（只比 size 抓不到）。
- `publish-release.ps1` 新增的响应体断言会在 PS 5.1 下误报（G54）：
  `Invoke-WebRequest -UseBasicParsing` 的 `.Content` 在 5.1 返回 `Byte[]` 而非 String，
  与 `-match` 比较恒为失败。已显式按 UTF-8 解码，并在 PS 5.1 宿主上复验通过。

### Added
- `test/safety-gates.js`（接入 `test/all.js`，套件 10 → **11**）：专守上述 A1–A7 / B3 / B4 / B6。
  其中 A1 用**真实 >32MB 文件对**做端到端可达性证明 —— 先断言扫描确实判为 `approx`，
  再断言合并被拒绝且两文件内容未变，而非只喂合成对象。该套件在编写过程中即抓到
  修复自身的一次过度收紧（用遍历用 `isSkip` 判扫描根会连带跳过 `%TEMP%`）。

### Docs
- 修正全仓库过期的测试套件数（9 → **10** → **11**）：`README.md`、`README.zh-CN.md`、
  `docs/RELEASE-PLAYBOOK.md` §3.2、`skills/release-sop/SKILL.md`
  （后者同时补上此前漏列的 `ci-workflow.js`）。
- 修正 CHANGELOG 中三个错误日期（与 GitHub Release / tag 实际日期对账）：
  0.5.0 `2026-08-17` → `2026-09-11`、0.4.1 → `2026-08-25`、0.4.0 → `2026-08-21`。
- `docs/OPTIMIZATION-PLAN.md`：加"历史归档"横幅；把 v0.4.0/v0.4.1 的状态头由
  "待执行/等确认后开工"改为已发布；标注 v0.4.1 中**涉及已删除 `plugin/` 形态的任务全部作废**；
  勾选 v0.5.0 的发布验收项。
- `docs/PROCESS-REVIEW.md`：修复重复的 `### 7.2` 标题（改为 7.2 / 7.3 / 7.4）；
  补编号体系图例（1–27 与 G1–G54 两套并存、G1–G8 是决策不是缺陷、G50–G54 的去向）；
  更新过期的文件头与第七节标题；把"版本四源 + 人工 grep"更正为"`lib/version.js` 单源 + 测试守门"。
- `docs/GUI-PLAN.md`：状态头由"v0.4.1 迭代进行中"更新为已随 v0.5.0 发布。
- `ROADMAP.md`：合并重复的 `## 9. Phase 7` 段；状态追踪表的 Phase 13/14/15 日期与真实 Release 对账；
  更正"npm 已发布"（实际首发未执行）与"测试 5→8 套件"（实为 11）。
- `docs/RELEASE-PLAYBOOK.md`：§4.3 补 checksums.txt 的 G53 铁律；§4 补第 32–35 条
  （抽样判重不得驱动破坏性操作 / 单源声明要能用 grep 证伪 / 前缀匹配与路径穿越一起审 /
  测试没覆盖的边界等于没有边界）；§6 补第 31 条（G54）。

## [0.5.0] - 2026-09-11

### Changed
- **AI 接入形态从 DSH 专有插件改为 MCP**（**破坏性变更**）：删除 `plugin/`（约 3400 行 DSH 专属代码、
  与 CLI 双份引擎、出货形态下面板技术不可行、零测试覆盖），新增内置
  [MCP](https://modelcontextprotocol.io) server。同一个 server 可被 DeepSeek Harness、
  Claude Desktop、Cursor 及任何 MCP 客户端使用。
- `engines.node` 从 `>=14.16` 提升到 `>=18.15`（`fs.statfsSync` 与 `node:sea` 的下限），
  三处文档同步。
- `lib/serve.js` 静态托管的越界判定改用 `path.relative`（原 `startsWith` 会放行同名前缀兄弟目录）。
- `lib/serve.js` 默认不再接受 URL query 里的 token（需 `DSK_ALLOW_QUERY_TOKEN=1` 才放开）。
- `clean-safety` 测试中的真实回收站删除改为 `DSK_TEST_REAL_DELETE=1` 门控；CI 改用 `npm ci`；
  workflow 顶层加 `permissions: contents: read`。

### Added
- **MCP server**：`lib/mcp/server.js`（协议核心，零依赖，stdio NDJSON，JSON-RPC 2.0，
  `initialize` / `ping` / `tools/list` / `tools/call`，五个标准错误码，`tools/call` 串行队列）
  + `lib/mcp/tools.js`（12 个工具）+ `bin/disk-clean-mcp.js` + `disk-clean mcp` 子命令 +
  `disk-clean-mcp` bin。
- **12 个 MCP 工具**：`disk_scan` / `disk_report` / `disk_drives` / `disk_clean` / `disk_organize` /
  `disk_dedup` / `disk_health` / `disk_quota` / `disk_mftscan` / `disk_audit` / `disk_recycle` /
  `disk_config`。每个都带 MCP 注解（`readOnlyHint` / `destructiveHint` 等）；
  破坏性工具默认 dry-run，需 `confirm:true`；所有失败都返回 `error + hint`（下一步动作）。
- **路径安全闸门单源化**：`lib/guard.js` —— 受保护路径段从 8 个扩到 16 个
  （新增 `Windows.old`、`$Windows.~BT`、`$Windows.~WS`、`Recovery`、`PerfLogs`、`MSOCache`、
  `Config.Msi`、`Boot`、`EFI`）；OneDrive 云同步段与扫描根归属判定也集中于此。
  `clean.js` / `organize.js` / `serve.js` 不再各写一份。
- **版本单一事实源**：`lib/version.js` —— 此前版本号散落在 6 处且只有一条 bump 脚本串联；
  现只有 `VERSION` 可写，`bin/disk-clean.js` 与 `lib/serve.js` 改为引用，
  `scripts/bump-version.js` 改完立即自校验，`test/version-consistency.js` 守住 7 个版本源。
- `test/mcp-protocol.js`：MCP 协议一致性 + 工具安全闸门测试（握手 / 注解透传 / 五个错误码 /
  受保护路径与 OneDrive 等安全负例 / 未确认即 dry-run / 子进程 stdout 纯净性）。
- `test/version-consistency.js`：版本漂移守门。
- `test/rules-integrity.js`：规则表完整性 —— 守住"同名 key 静默覆盖"这类看不见的缺陷
  （见下方 Fixed），并断言歧义扩展名的既定归属、阈值健全性、规则表与配置默认值一致。
- `scripts/mcp-e2e.js`：真实子进程端到端冒烟（扫描 → 清理 → 回收站恢复 → 查重 → 安全负例 →
  审计 → stdout 纯净性），并验证 dry-run 零副作用；可对源码或打包后的 exe 运行（`--exe`）。`npm run e2e:mcp`。
- `test/dsh-config.js`：验证 README 里给 DSH 的那段 `@deepseek-ai/dsh-mcp-client` 配置**可执行地**
  成立 —— 真拉起 server、走 DSH 握手、断言工具公开名 `mcp__disk-clean__<name>` 合法唯一、
  用公开名反查调用成功，并确认破坏性工具经该通道仍默认 dry-run。

### Fixed
- **清理 0 项不再误报成功**（模型/用户会据此宣布"清理完成"）：`clean.execute` 在
  `executed === 0` 时返回 `ok:false` 并说明原因。
- **`EXT_CAT` 里 `.ts` 重复定义被静默覆盖**：`.ts` 同时出现在「媒体」（MPEG 传输流）与
  「代码」（TypeScript）两行，后写覆盖先写 —— 分类结果与源码字面意思不符，`node --check`
  不报，只有 esbuild 打包时给一条易被忽略的 `duplicate-object-key` 警告。
  现只声明一次并显式定为「代码」（桌面/开发机上前者罕见），补入 `.mts`/`.m2ts`/`.mjs`/`.cjs`；
  由 `test/rules-integrity.js` 从源码层面守住不再复发。
- **清空回收站回报真实规模**：清理前枚举回收站得到真实条目数与字节数，
  返回里标注 `irreversible`，并二次校验"清空后条目数确实下降"才判成功。
- **硬链接回滚原子化**：原实现 `readFileSync` 整文件读入内存（几 GB 视频打爆内存）
  且先 `unlink` 再 `write`（中途失败即数据丢失）。现改为
  rename → 从保留副本 `copyFileSync` → 校验大小 → 删备份，任一步失败原地复原；
  回滚记录升级为 `{victim, keep, size}` 并 append-only，失败项保留以便重试。
- **临时目录判定改精确段匹配**：`temporary-report` 不再被当作临时目录；
  `hasTempSegment` 统一大小写不敏感。
- **dedup 扫描根不可访问时不再静默返回"0 组重复"**，而是明确报错。
- **盘符参数严格校验**：`/^([a-zA-Z]):?/` 会把 `nonsense` 当成 N 盘，改为整体匹配。
- `mcp`/`serve` 的版本号去掉硬编码，改从 `lib/version.js` 读取。

### Removed
- `plugin/` —— DSH 专有插件形态（host.static5.js / host.js / client.js / dsk-*.js / dsk-lib/ /
  DSH 技能副本）整体删除；仓库不再包含 DSH 专属 JS。
- `test/rules-parity.js` —— 随插件形态一起失去意义。
- `scripts/sync-rules.ps1` —— 为同步"双份引擎"而生，双份已不存在。
- `docs/SYNC-CHECKLIST.md`、`docs/RULES-DIFF.md` —— 同理，随插件形态失效。

### Docs
- `README.md` / `README.zh-CN.md`：Option C 从"DSH 插件"改为"MCP server"（含客户端配置示例与
  典型调用链）；特性表、安全模型（16 个受保护段 + OneDrive）、命令表、开发说明同步更新。
- `docs/RELEASE-PLAYBOOK.md`：§0 机制图与 §2 从"插件 SOP"重写为"MCP SOP"
  （含历史教训、协议要点、工具设计铁律、验证清单），并新增 5 条 MCP 编码铁律。
- `skills/release-sop`、`skills/gui-development`：提升为全局技能（`~/.agents/skills/`），
  内容与 MCP 形态对齐。

## [0.4.1] - 2026-08-25

### Added
- **OneDrive 云端安全**：含 `\OneDrive\` 段的路径计入统计，但排除哈希/查重与破坏性清理建议；
  报告与 GUI 显示提示条。
- **一键全清（仅低风险）**：清理中心合并预览 `junk-temp` + `empty-dirs`，单次确认顺序执行。
- **健康趋势**：`/api/health-check` 返回 `trend` 迷你趋势线（最近 20 点，60s 节流 + 30s 缓存）。
- **回收站恢复（仅本工具项）**：`/api/recycle/list` 与 `/api/recycle/restore` + GUI 入口。
- **引擎核心单源**：`lib/engine-core.js` 为唯一可编辑核心，`lib/engine.js` 为薄壳。

## [0.4.0] - 2026-08-21

### Added
- **MFT 直读快速扫描**（`mftscan <drive>`，需管理员）：解析碎片化 $MFT runlist、路径重建、alloc/real 合理性 size 规则；实测 ~8x 提速（D 盘 5.5s vs 43.1s），文件数/目录数与常规遍历一致（99%/100%）。
- **全盘去重**（`dedup [roots...]`）：head/tail 两阶段哈希 + 小文件全哈希确认；`--hardlink --yes` 转硬链接省空间，`dedup rollback` 还原。D 盘实测 1503 组、可释放 17.3 GB。
- **每用户配额分析**（`quota [drive]`，需管理员）：基于 MFT 目录聚合，用户排行 + Downloads/Documents/Desktop/AppData 等子目录明细。
- **SMART/SSD 健康检查**（`health`）：温度 / 寿命 Wear / 通电小时 / 读写错误 + 健康分级（健康/注意/警告/危险）。
- **定时扫描**（`schedule add|run|list|remove`）：Windows 任务计划注册 + 报告归档到 `~/.disk-clean/reports/`。
- **系统还原点**（`--restore-point`）：破坏性操作前可选创建，失败降级不中断。
- **i18n 报告**（`--lang en|zh`）：Markdown 报告双语模板，自动检测系统语言。
- **规则配置**（`config`）：阈值 / exclude 白名单 / 保留策略。

### Fixed
- schtasks 中文输出 GBK 解码；cmd /c 引号包裹；任务入口路径。
- MFT 记录解析：FILE_NAME 偏移、runlist 符号扩展 32 位溢出、稀疏文件 size 超卷兜底。

## [0.3.1] - 2026-08-16

> GUI 修复迭代，由用户反馈回归触发。依据：`git log v0.3.0..v0.3.1` + 该版 Release 正文。

### Fixed
- **盘符容量显示错误**：改用 `fs.statfsSync` 读真实卷容量 —— 此前用 `statSync(root).blocks`
  得到的是**根目录自身占用的块数**（几十 KB，界面上显示约 24KB），与卷容量无关。
- **默认选择**：首次启动默认只选 `D:` 并记住上次选择（不再默认全选）。
- **"选中 D 却扫出 2.2TB"**：实为默认全选 + 点击切换导致扫了 C+E+F 三盘合计。
  新增**扫描前范围确认弹窗**（列出各盘已用/合计/排除路径），报告顶部回显扫描范围。
- **去重硬链接合并的范围**：不再静默回退到扫描 `C:\`+`D:\`，只复用最近一次主页扫描范围，
  无报告则明确报错。

### Changed
- 统一包版本号为 0.3.0 并刷新校验和；`--help` 补上 `serve` 子命令说明。

## [0.3.0] - 2026-08-16

> 第三形态：原生 GUI 桌面应用（WebView2）。依据：`git log v0.2.0..v0.3.0` + 该版 Release 正文。
> 同期把 DSH 插件预设入仓（该形态已于 v0.5.0 整体删除）。

### Added
- **原生 GUI 桌面应用**（C# WinForms + WebView2，.NET 8 框架依赖单 exe ~24MB），
  配 Inno Setup 安装器 `disk-clean-setup-0.3.0.exe`（~26MB）：
  自动检测 .NET 8 Desktop Runtime / WebView2，缺失时引导官方下载；含开始菜单/桌面快捷方式与卸载器。
- **引擎 `serve` HTTP 层**（`lib/serve.js`）：仅绑 `127.0.0.1` + Bearer 鉴权，GUI 复用 CLI 引擎。
- **两级前端 UI**：主页 + 8 个高级 Tab。
- `README.zh-CN.md`（含语言切换）。

### Docs
- `docs/RELEASE-PLAYBOOK.md`（可复用制作/发布 SOP）、`docs/PROCESS-REVIEW.md`（全流程复盘）。

## [0.2.0] - 2026-08-16

> 首个功能完整版本（v0.1.0 只有 scan/report/organize/clean/audit 骨架）。
> 依据：`git log v0.2.0` 的 10 个提交 + `docs/RELEASE_NOTES-v0.2.0.md`。

### Added
- **MFT 直读快速扫描**（`mftscan <drive>`，需管理员）：解析碎片化 NTFS `$MFT`（runlist、
  路径重建、alloc/real 尺寸规则）。实测比目录遍历**快约 8 倍**（150 万记录卷：5.5s vs 43.1s），
  文件数/目录数与遍历一致（99%/100%）。
- **全盘去重**（`dedup [roots...]`）：head/tail + 全量哈希两阶段，排除系统/程序目录。
  D 盘实测 **1503 组重复、约 17.3 GB 可释放**。可选 `--hardlink --yes` 合并为硬链接，
  配 `dedup rollback` 回滚。
- **每用户配额**（`quota <drive>`，需管理员）：基于 MFT 的用户占用排行 + 子目录明细。
- **SMART / SSD 健康**（`health`）：温度、寿命 Wear、通电小时、读写错误 + 健康分级。
- **定时扫描**（`schedule add|run|list|remove`）：Windows 任务计划 + 报告归档。
- **系统还原点**（`--restore-point`）：破坏性操作前可选创建，系统保护关闭时优雅降级。
- **i18n 报告**（`--lang en|zh`）：双语 Markdown 报告 + 语言自动检测。
- **规则配置**（`config`）：阈值、exclude 白名单、保留策略。

### Fixed
- `bin/package.json` 曾被 GBK 重写破坏，本版修复并验证 exe 内全命令可用。

## [0.1.0] - 2026-08-16

### Added
- v0.1.0 首个可运行版本：独立 CLI（scan / report / organize / clean / fix-shortcuts / audit）
  - 全盘扫描 + 智能建议（散落目录/重复文件/垃圾/陈旧大文件/空目录）
  - 目录整理：移动可回滚，程序目录自动重写快捷方式（fixShortcuts）
  - 垃圾清理：移入回收站（可恢复），默认 dry-run + `--yes` 确认
  - 审计日志 JSONL
  - 报告输出 JSON + Markdown 双格式
（首个发布版）
