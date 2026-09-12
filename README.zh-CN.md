# disk-clean

**Windows 磁盘清理与分析 CLI** —— 扫描、分类、智能建议、安全整理（自动修复快捷方式）与清理你的磁盘。零运行时依赖，可离线使用。

> ⚠️ 安全第一：所有破坏性命令**默认 dry-run（试运行）**。除非传入 `--yes`，否则不会移动或删除任何内容。移动操作均有日志且可回滚。

---

## v0.6.0 更新内容

**安全加固版 —— 建议所有 v0.5.x 用户升级。** 一次针对 v0.5.0 的独立锐评发现 1 个 P0 与若干安全缺陷，全部复现后修复。

- **硬链接合并不再接受"仅头尾抽样"的近似组（P0，不可逆数据破坏）**：>32MB 的文件只比对头 64KB + 尾 64KB 就标 `approx:true`，而 CLI / MCP / GUI 三条路径都不过滤该标志就直接合并。实测复现：两个 33MB 文件（头尾相同、中间不同）被合并成硬链接，第二个文件内容永久消失，且 `.dsk-dup-bak` 备份已删除。现 `hardlinkGroup()` 硬性拒绝 approx 组；精确组照常合并，MCP 侧引导模型改用 `disk_clean duplicates`（回收站，可恢复）。
- **安全闸门真正单源**：README 曾宣称保护名单只在 `lib/guard.js`，实际另有 4 份副本（各 7 段、缺 `windows.old`/`boot`/`efi`/`recovery` 等 9 段），且 `organize.js` 那份缺尾部匹配 —— 同一个 `C:\Users\me\windows` 清理侧拒绝、整理侧放行。
- **硬链接合并过安全闸门**；扫描根自身受保护时（`C:\Windows\System32\drivers`）拒绝而非照常遍历。
- **整理目标不再可穿越**：`C:\整理区\..\boot\x` 此前能通过前缀正则并被解析成 `C:\boot\x`。
- **部分成功不再伪装成成功**：5 项只成功 3 项时返回 `partial:true`，MCP 层上报 `isError`，模型无法据此宣布"清理完成"。
- **`dedup-map.json` 统一 schema**（MCP 写 `entries`、CLI/GUI 写 `merged`，导致 AI 合并的文件在别处回滚不了）；回收站匹配统一 `canonKey`（GUI 此前列不出自己的短名清理项）；回滚映射改原子写；畸形 URL 转义返回 400 而非抛异常。
- **发布完整性**：CI 自己的 `checksums.txt` 曾与本地 exe 一起发布 —— v0.5.0 资产写着 `sha256=72ce9f21…`，而 exe 是 `3cbdc188…`。现发布脚本重算、上传并**下载回来断言哈希**。

新增 `test/safety-gates.js`（套件共 11 个、23 组断言）守住以上每一项，含用**真实 >32MB 文件**做的端到端可达性证明。

## v0.5.0 更新内容

- **AI 接入方式改为 MCP**：新增内置 [MCP](https://modelcontextprotocol.io) server（`disk-clean mcp`，stdio，**零依赖**），把 12 个磁盘工具暴露给任意 MCP 客户端 —— DeepSeek Harness、Claude Desktop、Cursor 等都能直接调用。原先的 DSH 专有插件形态（约 3400 行 DSH 专属代码、无法在出货形态提供图表面板）已整体删除。
- **12 个 MCP 工具**：`disk_scan` / `disk_report` / `disk_drives` / `disk_clean` / `disk_organize` / `disk_dedup` / `disk_health` / `disk_quota` / `disk_mftscan` / `disk_audit` / `disk_recycle` / `disk_config`。全部带 MCP 注解（`readOnlyHint` / `destructiveHint`），破坏性工具**默认 dry-run**，必须显式 `confirm:true`。
- **安全闸门单源化**：新增 `lib/guard.js` 作为唯一事实源（受保护路径 / OneDrive 云同步 / 扫描根归属），`clean.js`、`organize.js`、`serve.js` 不再各写一份。受保护段扩充到 16 个（新增 `Windows.old`、`$Windows.~BT`、`Recovery`、`PerfLogs`、`MSOCache`、`Config.Msi`、`Boot`、`EFI`）。
- **版本单一事实源**：新增 `lib/version.js`。此前版本号散落在 6 处，现在只有一处可写、其余派生，`bump-version.js` 改完立即自校验，`test/version-consistency.js` 守住漂移。
- **修复的实际缺陷**：清理 0 项时不再误报成功；清空回收站回报真实条目数并标注不可恢复；硬链接回滚改为原子序列（不再整文件读进内存、不再"先删后写"）；静态托管越界判定改用 `path.relative`；query 里的 token 默认不再接受；临时目录判定改精确段匹配（`temporary-report` 不再被误判）。

## v0.4.1 更新内容

- **OneDrive 云端安全**：`\OneDrive\` 文件会计入统计，但不参与哈希/查重与破坏性清理；报告与界面显著提示“OneDrive 云端文件不参与查重与清理”。
- **一键全清（仅低风险）**：清理中心 → “一键全清（低风险）” 合并预览 `临时/缓存 + 空目录`，单次确认顺序执行；中/高风险项仍需逐项确认。
- **健康趋势**：`/api/health-check` 返回 `trend` 迷你趋势线（最近 20 点，60s 节流 + 30s 缓存），UI 展示温度/寿命/错误趋势。
- **回收站恢复（仅本工具项）**：`GET /api/recycle/list` / `POST /api/recycle/restore` + 清理中心“回收站恢复”入口（审计匹配 scope A）。
- **引擎核心单源**：`lib/engine-core.js` 为唯一可编辑核心，`lib/engine.js` 为薄壳，插件侧混合引用 + 生成产物校验。

## 为什么选 disk-clean？

| 功能 | disk-clean | WizTree | CCleaner | 360/火绒 |
|---|---|---|---|---|
| 基于 raw NTFS MFT 的快速扫描（管理员） | ✅ **约 8 倍速** | ✅ | ❌ | ✅ |
| 移动目录到 `整理区` 且**可回滚** | ✅ | ❌ | ❌ | ❌ |
| 移动程序目录后**重写桌面/开始菜单快捷方式** | ✅（独有） | ❌ | ❌ | ❌ |
| 重复文件检测（用户区，基于哈希） | ✅ | ❌ | ✅ | ✅ |
| **全盘去重 + 硬链接合并** | ✅ | ❌ | ❌ | ❌ |
| **按用户配额分析** | ✅ | ✅ | ❌ | ❌ |
| **SMART / SSD 健康检查** | ✅ | ✅ | ❌ | ❌ |
| 每项操作的审计日志（JSONL） | ✅ | ❌ | ❌ | ❌ |
| 可读的 **Markdown 报告（中/英）** | ✅ | ❌ | ❌ | ❌ |
| 回收站安全（非直接永久删除） | ✅ | ❌ | ✅ | ✅ |
| OneDrive 云端安全（统计保留，不哈希/不删） | ✅ | ❌ | ❌ | ❌ |
| 一键全清（仅低风险批量） | ✅ | ❌ | ❌ | ❌ |
| 开源、无遥测、无广告 | ✅ | ✅ | ❌ | ❌ |
| **AI 集成（MCP，任意客户端通用）** | ✅ | ❌ | ❌ | ❌ |

---

## 安装

### 方式 A —— 单个 EXE（推荐）

从 [Releases](https://github.com/ShuiQiongChuYunQiShi/disk-clean-cli/releases) 下载 `disk-clean-win-x64.exe` —— 无需安装 Node.js。

```powershell
.\disk-clean-win-x64.exe scan D:\
```

### 方式 B —— 通过 Node.js（>= 18.15）

```powershell
npm install -g disk-clean    # 或：git clone + npm link
disk-clean scan D:\
```

> npm 渠道自 2026-08-25 起一直停留在 0.4.1（既无 MCP server，也不含 v0.6.0 的安全修复），
> 直到 **2026-09-11 发布 0.6.0**。若你在此之前装过，请升级：`npm install -g disk-clean@latest`。

### 方式 C —— MCP server（AI 驱动，任意客户端通用）

`disk-clean mcp` 启动一个标准 **MCP（Model Context Protocol）** server，通过 stdio 把 12 个磁盘工具暴露给 AI 客户端。零依赖、不需要额外的 SDK。

```jsonc
// DeepSeek Harness / Claude Desktop / Cursor —— 通用配置
{
  "mcpServers": {
    "disk-clean": { "command": "npx", "args": ["-y", "disk-clean", "mcp"] }
  }
}
```

配置之后可以直接对 AI 说：
> "D 盘快满了，先扫一遍告诉我哪些能清，再帮我把临时文件和空目录清掉。"

AI 的典型调用链是 `disk_drives`（看容量）→ `disk_scan`（扫描出报告）→ `disk_clean`（先 dry-run 预览，再 `confirm:true` 执行）。**破坏性工具默认只预览**，AI 必须显式确认才动文件；系统目录、OneDrive 云同步目录、扫描范围外的路径一律拒绝。本地开发可直接用 `node bin/disk-clean-mcp.js`。

<details>
<summary><b>在 DeepSeek Harness（DSH）里接入</b></summary>

DSH 用 `@deepseek-ai/dsh-mcp-client` 插件读 MCP server。在你的 agent preset 的 `agent.cordis.yml` 里加一行即可（**零自定义 JS**，工具会以 `mcp__disk-clean__disk_scan` 这样的名字出现）：

```yaml
- name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: disk-clean
    transport: stdio
    command: node
    args: ['D:\\deepseekHerness\\disk-clean-cli\\bin\\disk-clean-mcp.js']
```

全局安装过 npm 包时也可以用 `command: npx` + `args: ['-y', 'disk-clean', 'mcp']`。

> v0.5.0 之前本仓库自带一个 DSH 专有插件预设（`plugin/`）。它已删除：约 3400 行 DSH 专属代码、与 CLI 双份引擎、出货形态下无法渲染面板、且零测试覆盖。上面这一行配置提供同样的能力，且不产生维护面。
</details>

### 方式 D —— 原生 GUI 窗口（WebView2）

从 [Releases](https://github.com/ShuiQiongChuYunQiShi/disk-clean-cli/releases) 下载 `disk-clean-setup-<版本>.exe` —— 原生桌面窗口（WinForms + WebView2），双语（中/英）仪表盘：一键扫描、智能建议、一键清理，另含高级页（整理 / 健康 / 去重 / 配额 / MFT / 计划任务 / 配置 / 审计）。安装器检测 .NET 8 Desktop Runtime 与 WebView2，缺失时引导下载。详见 [docs/GUI-PLAN.md](docs/GUI-PLAN.md)。

---

## 快速上手

```powershell
# 1. 扫描磁盘（报告：JSON + Markdown）
disk-clean scan C:\ D:\

# 2. 查看报告（终端摘要 + Markdown 渲染）
disk-clean report

# 3. 生成整理计划（散落目录 → <盘符>:\整理区\<分类>\）
disk-clean organize plan

# ……也包含程序/游戏目录（⚠ 移动后会重写快捷方式）
disk-clean organize plan --include-program

# 4. 先预览，再真正移动（默认 dry-run；加 --yes 执行）
disk-clean organize apply
disk-clean organize apply --yes

# 5. 撤销上一批（移动 + 快捷方式一并还原）
disk-clean organize rollback --yes

# 6. 清理垃圾（临时文件 / 空目录 / 重复文件 / 回收站）
disk-clean clean empty-dirs              # 预览
disk-clean clean empty-dirs --yes        # 执行（移入回收站）

# 7. 手动修复失效快捷方式
disk-clean fix-shortcuts pairs.json

# 8. 查看审计日志
disk-clean audit

# 9. MFT 快速扫描（需管理员，比目录遍历约快 8 倍）
disk-clean mftscan D:

# 10. 全盘重复文件检测（排除系统/程序目录）
disk-clean dedup D:\

# 11. 将重复文件合并为硬链接以释放空间（可回滚）
disk-clean dedup D:\ --hardlink --yes
disk-clean dedup rollback

# 12. 按用户配额分析（需管理员）
disk-clean quota C:

# 13. SMART / SSD 健康检查
disk-clean health

# 14. 破坏性操作前创建系统还原点
disk-clean organize apply --yes --restore-point

# 15. 英文报告
disk-clean scan D:\ --lang en

# 16. 启动 MCP server（供 AI 客户端接入；stdio 常驻）
disk-clean mcp
```

---

## 命令

| 命令 | 说明 |
|---|---|
| `scan [roots...]` | 全盘扫描并给出智能建议（散落目录、重复文件、长期未用大文件、垃圾、空目录）。生成 `report.json` + `report.md`。 |
| `report [file]` | 渲染已保存的报告（终端 + Markdown）。 |
| `organize plan` | 生成整理计划：散落目录 → `<盘符>:\整理区\<分类>\`。`--include-program` 额外加入程序/游戏目录并提示快捷方式修复风险。 |
| `organize apply [file]` | 执行计划。**默认 dry-run，除非加 `--yes`。** 程序目录必须带 `fixShortcuts`；快捷方式会被重写，回滚时还原。 |
| `organize rollback` | 撤销上一批（移动 + 快捷方式）。**默认 dry-run，除非加 `--yes`。** |
| `clean <type> [paths...]` | `junk-temp` \| `empty-dirs` \| `duplicates` \| `recycle-bin`。**默认 dry-run，除非加 `--yes`。** 项目移入回收站（可恢复）；仅回收站清空为永久删除。 |
| `fix-shortcuts <pairs.json>` | 重写指向已移动路径的 `.lnk` 文件（桌面 / 开始菜单 / 任务栏）。 |
| `audit` | 显示 JSONL 审计日志。 |
| `config` | 规则配置：白名单/黑名单、阈值、保留策略。 |
| `schedule` | 通过 Windows 任务计划程序进行定时扫描。 |
| `mftscan <drive>` | **实验性：** raw NTFS MFT 扫描（需管理员）—— 比目录遍历约快 8 倍；解析分片 $MFT runlist、重建完整路径，按 alloc/real 规则计算大小。 |
| `dedup [roots...]` | 全盘重复文件检测（排除系统/程序目录；头部/尾部 + 全量哈希策略）。`--hardlink --yes` 将重复文件合并为硬链接；`dedup rollback` 还原。 |
| `quota [drive]` | 通过 MFT 做按用户配额分析（需管理员）：用户排名 + 每人 Downloads/Documents/Desktop/… 明细。 |
| `health` | SMART / SSD 健康：温度、磨损百分比、通电小时、读写错误并给出健康等级。 |
| `mcp` | 启动 **MCP server**（stdio，12 个工具），供 DeepSeek Harness / Claude Desktop / Cursor 等 AI 客户端接入。stdout 只输出协议消息，诊断信息走 stderr。 |
| `build-info` | 以 JSON 输出本构建的身份信息（`version` / `commit` / `dirty` / `builtAt`）。用于证明下载到的 exe 就是已发布的那个构建：发布页的 `checksums.txt` 携带同一个 commit。 |
| `--restore-point` | 加在 `clean` / `organize apply` 前，先创建系统还原点（系统保护关闭时优雅失败）。 |
| `--lang en\|zh` | `scan` 的报告语言（自动检测，默认跟随系统语言）。 |

---

## 安全模型

- **默认 dry-run** —— 每个破坏性命令先打印它将*会*做什么；加 `--yes` 才真正执行。
- **回收站** —— 垃圾/空目录/重复文件先移入回收站，而非直接永久删除。
- **回滚** —— 目录移动追加进 `organize-map.json`；`organize rollback` 还原上一批（含快捷方式）。
- **受保护路径** —— 16 个受保护段永远拒绝操作：`\windows\`、`\windows.old\`、`\program files\`、`\program files (x86)\`、`\programdata\`、`\winsxs\`、`\system volume information\`、`\$recycle.bin\`、`\$windows.~bt\`、`\$windows.~ws\`、`\recovery\`、`\perflogs\`、`\msocache\`、`\config.msi\`、`\boot\`、`\efi\`。名单只有一份（`lib/guard.js`），由 `test/docs-consistency.js` 断言本清单与它逐条一致。
- **OneDrive 云同步** —— 含 `\OneDrive\` 段的路径一并拒绝破坏性操作（删除会同步影响云端；哈希会触发占位文件静默下载）。
- **审计日志** —— 每项操作追加到 `~/.disk-clean/audit.jsonl`（时间 / 类型 / 路径 / 结果 / 真实条目数）。
- **退出码** —— 0 正常 · 1 用户取消/参数错误 · 2 运行错误 · 3 扫描被取消。

状态文件位于 `~/.disk-clean/`：
```
audit.jsonl            # 审计日志
report.json / .md      # 最新报告
organize-map.json      # 回滚映射
organize-plan.json     # 最近一次计划
```

---

## 示例输出

```
▶ 正在扫描: D:\
✔ 扫描完成  (43.1s)
  总大小   : 630.2 GB   文件: 1381931   目录: 196460
  报告     : C:\Users\Administrator\.disk-clean\report.json
  Markdown : C:\Users\Administrator\.disk-clean\report.md

── 智能建议 ──
  [organize-folders] 目录整理建议 — 13 项 (164.0 GB)
  [stale-large] 清理长期未使用的大文件 — 14 项 (15.4 GB)
  [duplicates] 重复文件 — 46 组 (可释放约 110 MB)
  [recycle-bin] 清空回收站 — 67 MB
  [empty-dirs] 删除空文件夹 — 4490 项

▶ MFT 直读扫描: D:
✔ 扫描完成  (5.5s)   ← 比目录遍历约快 8 倍
  D:  总大小: 532 GB  文件: 1362274  目录: 196450

▶ 全盘重复检测: D:\
✔ 扫描完成  (35.1s)  重复组: 1503  可释放: 17.3 GB

▶ 配额分析: C:
  administrator   1.1 TB  (74.9%)
      ├ Desktop  77.8 GB
      ├ AppData  875 GB
```

完整 Markdown 报告样例见 [docs/demo-report.md](docs/demo-report.md)。

---

## 开发

```powershell
npm run check     # 所有模块语法检查
npm test          # 全量测试（15 个套件，含 MCP 协议 / 规则完整性 / 安全闸门 / 文档一致性回归）
npm run mcp       # 本地起一个 MCP server
powershell -File scripts\build-sea.ps1   # 构建 exe + sha256（含构建指纹）
```

- 引擎：`lib/engine-core.js`（唯一可编辑核心）→ `lib/engine.js`（薄壳）—— 零依赖 Node（原生 `fs`），仅快捷方式修复使用 PowerShell COM。
- 安全闸门：`lib/guard.js`（单一事实源）；版本：`lib/version.js`（单一事实源）。
- MCP：`lib/mcp/server.js`（协议核心，零依赖）+ `lib/mcp/tools.js`（12 个工具，全部是 `lib/*` 的薄封装）。
- CLI 与 MCP server 都是薄壳，业务逻辑没有第二份。

## 可复用流程

见 [docs/RELEASE-PLAYBOOK.md](docs/RELEASE-PLAYBOOK.md) —— 构建 CLI/GUI、发布到 GitHub 与 npm 并产出 Release 资产的逐步 SOP（可用于新项目复用）。GUI 专项细节见 `skills/gui-development`，发布专项见 `skills/release-sop`。

## Roadmap

见 [ROADMAP.md](ROADMAP.md) —— 12 个阶段：配置规则、定时扫描、MFT 快速扫描、SMART 健康、全盘去重、按用户配额、系统还原点、i18n。

## 许可证

[MIT](LICENSE)