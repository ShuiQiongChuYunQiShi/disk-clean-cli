# Changelog

## [0.5.0] - 2026-08-17

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
  审计 → stdout 纯净性），并验证 dry-run 零副作用。`npm run e2e:mcp`。

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

## [0.4.1] - 2026-08-17

### Added
- **OneDrive 云端安全**：含 `\OneDrive\` 段的路径计入统计，但排除哈希/查重与破坏性清理建议；
  报告与 GUI 显示提示条。
- **一键全清（仅低风险）**：清理中心合并预览 `junk-temp` + `empty-dirs`，单次确认顺序执行。
- **健康趋势**：`/api/health-check` 返回 `trend` 迷你趋势线（最近 20 点，60s 节流 + 30s 缓存）。
- **回收站恢复（仅本工具项）**：`/api/recycle/list` 与 `/api/recycle/restore` + GUI 入口。
- **引擎核心单源**：`lib/engine-core.js` 为唯一可编辑核心，`lib/engine.js` 为薄壳。

## [0.4.0] - 2026-08-17

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

## [0.1.0] - 2026-08-16

### Added
- v0.1.0 首个可运行版本：独立 CLI（scan / report / organize / clean / fix-shortcuts / audit）
  - 全盘扫描 + 智能建议（散落目录/重复文件/垃圾/陈旧大文件/空目录）
  - 目录整理：移动可回滚，程序目录自动重写快捷方式（fixShortcuts）
  - 垃圾清理：移入回收站（可恢复），默认 dry-run + `--yes` 确认
  - 审计日志 JSONL
  - 报告输出 JSON + Markdown 双格式
（首个发布版）
