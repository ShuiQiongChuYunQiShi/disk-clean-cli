# disk-clean

> **English** | [**简体中文**](README.zh-CN.md)

**Windows disk cleanup & analysis CLI** — scan, classify, suggest, safely organize (with automatic shortcut fixing) and clean your disks. Zero runtime dependencies, works offline.

> ⚠️ Safety first: every destructive command is **dry-run by default**. Nothing is moved or deleted unless you pass `--yes`. Moves are logged and rollback-able.

---

## What's new in v0.6.0

**Security hardening — upgrade recommended for all v0.5.x users.** An independent review of v0.5.0 found one P0 and several safety defects; all were reproduced before being fixed.

- **Hardlink merges no longer accept sampled matches (P0, irreversible data loss).** Files over 32MB are compared by head-64KB + tail-64KB only and flagged `approx:true` — but CLI, MCP and GUI all merged those groups anyway. Reproduced: two 33MB files with identical head/tail and different middles became a hardlink, and the second file's content was gone, with the `.dsk-dup-bak` backup already deleted. `hardlinkGroup()` now refuses approx groups outright; exact groups still merge normally, and MCP points the model at `disk_clean duplicates` (recycle bin, recoverable) instead.
- **The safety gate is now genuinely single-source.** README claimed the protected-path list lived only in `lib/guard.js`; four more copies were alive (each with 7 segments instead of 16, missing `windows.old`, `boot`, `efi`, `recovery` and 5 more), and the copy in `organize.js` also lacked the trailing match — so `C:\Users\me\windows` was refused by clean and allowed by organize.
- **Hardlink merging consults the gate**, and a scan root that is itself protected (`C:\Windows\System32\drivers`) is now refused instead of walked.
- **Organize destinations can no longer traverse**: `C:\整理区\..\boot\x` used to pass a prefix regex and resolve to `C:\boot\x`.
- **Partial cleans no longer report success.** If 3 of 5 items are locked or denied, the tool now returns `partial:true` and the MCP layer raises `isError`, so a model cannot announce "cleanup complete".
- **`dedup-map.json` has one schema** (MCP wrote `entries`, CLI/GUI wrote `merged` — so files merged by the AI could not be rolled back elsewhere); recycle-bin matching uses `canonKey` on both paths (GUI could not list its own short-name cleanups); rollback maps are written atomically; malformed URL escapes return 400 instead of throwing.
- **Release integrity**: a stale `checksums.txt` from CI's own build used to ship alongside the local exe — v0.5.0 shipped `sha256=72ce9f21…` for an exe hashing `3cbdc188…`. The publish script now recomputes, uploads and *downloads back to verify*.

New `test/safety-gates.js` (11 suites total, 23 assertion groups) guards every item above — including an end-to-end proof with real >32MB files.

## What's new in v0.5.0

- **AI integration moved to MCP**: a built-in [MCP](https://modelcontextprotocol.io) server (`disk-clean mcp`, stdio, **zero dependencies**) exposes 12 disk tools to any MCP client — DeepSeek Harness, Claude Desktop, Cursor. The previous DSH-only plugin form (~3400 lines of DSH-specific code that could never render its panel in the shipped build) is gone.
- **12 MCP tools**: `disk_scan` / `disk_report` / `disk_drives` / `disk_clean` / `disk_organize` / `disk_dedup` / `disk_health` / `disk_quota` / `disk_mftscan` / `disk_audit` / `disk_recycle` / `disk_config`, each carrying MCP annotations (`readOnlyHint` / `destructiveHint`). Destructive tools are **dry-run by default** and require an explicit `confirm:true`.
- **One safety gate, one source**: new `lib/guard.js` (protected paths / OneDrive / scan-root membership) replaces the copies in `clean.js`, `organize.js` and `serve.js`. Protected segments grew to 16 (adds `Windows.old`, `$Windows.~BT`, `Recovery`, `PerfLogs`, `MSOCache`, `Config.Msi`, `Boot`, `EFI`).
- **One version source**: new `lib/version.js`. The version used to live in 6 places; now one is writable and the rest derive from it, `bump-version.js` self-verifies, and `test/version-consistency.js` guards against drift.
- **Real defects fixed**: a 0-item clean no longer reports success; emptying the recycle bin reports the true item count and flags it irreversible; hardlink rollback is now an atomic sequence (no whole-file reads, no delete-then-write); static file serving uses `path.relative` for containment; query-string tokens are rejected by default; temp detection is exact-segment (`temporary-report` is no longer mistaken for a temp dir).

## What's new in v0.4.1

- **OneDrive cloud-safe**: `\OneDrive\` files are counted but excluded from dedup hash and destructive suggestions; report/UI shows "OneDrive cloud files excluded (avoids silent download/delete)".
- **Bulk low-risk clean**: Clean Center → "One-click clean (low-risk)" previews `junk-temp` + `empty-dirs` together, single confirm; medium/high-risk types still require per-card confirm.
- **Health trend**: `/api/health-check` returns `trend` sparklines (last 20) with 60s history throttle + 30s cache; UI shows Temp/Wear/Error trends.
- **Recycle restore (audit-matched)**: `GET /api/recycle/list` / `POST /api/recycle/restore` + Clean Center "Recycle restore" (scope A).
- **Engine-core single source**: `lib/engine-core.js` is the sole editable core; `lib/engine.js` is a thin wrapper, plugin shims hybrid-require it.

## Why disk-clean?

| Feature | disk-clean | WizTree | CCleaner | 360/火绒 |
|---|---|---|---|---|
| Fast scan via raw NTFS MFT (admin) | ✅ **~8x faster** | ✅ | ❌ | ✅ |
| Move dirs to `整理区` with **rollback** | ✅ | ❌ | ❌ | ❌ |
| **Rewrite desktop/start-menu shortcuts** after moving program dirs | ✅ (unique) | ❌ | ❌ | ❌ |
| Duplicate detection (user zones, hash-based) | ✅ | ❌ | ✅ | ✅ |
| **Full-disk dedup + hardlink merge** | ✅ | ❌ | ❌ | ❌ |
| **Per-user quota analysis** | ✅ | ✅ | ❌ | ❌ |
| **SMART / SSD health check** | ✅ | ✅ | ❌ | ❌ |
| Audit log (JSONL) of every action | ✅ | ❌ | ❌ | ❌ |
| Readable **Markdown report (EN/ZH)** | ✅ | ❌ | ❌ | ❌ |
| Recycle-bin safety (not permanent delete) | ✅ | ❌ | ✅ | ✅ |
| OneDrive cloud-safe (stats kept, no hash/delete) | ✅ | ❌ | ❌ | ❌ |
| Bulk low-risk one-click clean | ✅ | ❌ | ❌ | ❌ |
| Open source, no telemetry, no ads | ✅ | ✅ | ❌ | ❌ |
| **AI integration (MCP, any client)** | ✅ | ❌ | ❌ | ❌ |

---

## Install

### Option A — single EXE (recommended)

Download `disk-clean-win-x64.exe` from [Releases](https://github.com/ShuiQiongChuYunQiShi/disk-clean-cli/releases) — no Node.js required.

```powershell
.\disk-clean-win-x64.exe scan D:\
```

### Option B — via Node.js (>= 18.15)

```powershell
npm install -g disk-clean    # or: git clone + npm link
disk-clean scan D:\
```

> The npm channel was stuck on 0.4.1 (which predates both the MCP server and the v0.6.0
> security fixes) from 2026-08-25 until **0.6.0 was published on 2026-09-11**. If you installed
> before then, upgrade: `npm install -g disk-clean@latest`.

### Option C — MCP server (AI-driven, works with any client)

`disk-clean mcp` starts a standard **MCP (Model Context Protocol)** server that exposes 12 disk tools over stdio. Zero dependencies — no SDK, no build step.

```jsonc
// DeepSeek Harness / Claude Desktop / Cursor — same config everywhere
{
  "mcpServers": {
    "disk-clean": { "command": "npx", "args": ["-y", "disk-clean", "mcp"] }
  }
}
```

Then just ask:
> "D: is nearly full — scan it, tell me what's safe to remove, then clean up temp files and empty folders."

The typical call chain is `disk_drives` (capacity) → `disk_scan` (build a report) → `disk_clean` (dry-run preview, then `confirm:true`). **Destructive tools only preview unless explicitly confirmed**; system paths, OneDrive folders and anything outside the scanned roots are refused outright. For local development use `node bin/disk-clean-mcp.js` directly.

<details>
<summary><b>Wiring it into DeepSeek Harness (DSH)</b></summary>

DSH reads MCP servers through its `@deepseek-ai/dsh-mcp-client` plugin. Add one row to your agent preset's `agent.cordis.yml` (**no custom JS**; tools surface as `mcp__disk-clean__disk_scan` and friends):

```yaml
- name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: disk-clean
    transport: stdio
    command: node
    args: ['D:\\deepseekHerness\\disk-clean-cli\\bin\\disk-clean-mcp.js']
```

With the npm package installed globally you can use `command: npx` and `args: ['-y', 'disk-clean', 'mcp']` instead.

> Before v0.5.0 this repo shipped a DSH-only agent preset (`plugin/`). It is gone: ~3400 lines of DSH-specific code, a duplicated engine, a panel that could not render in the shipped build, and zero test coverage. The row above provides the same capability with no maintenance surface.
</details>

### Option D — Native GUI (WebView2 window)

Download `disk-clean-setup-<ver>.exe` from [Releases](https://github.com/ShuiQiongChuYunQiShi/disk-clean-cli/releases) — a native desktop window (WinForms + WebView2) with a bilingual (zh/en) dashboard: one-click scan, suggestions, cleanup, plus advanced tabs (organize / health / dedup / quota / MFT / schedule / config / audit). The installer detects and bootstraps .NET 8 Desktop Runtime and WebView2 when missing. See [docs/GUI-PLAN.md](docs/GUI-PLAN.md) and [README.zh-CN.md](README.zh-CN.md).

---

## Quick start

```powershell
# 1. Scan a drive (report: JSON + Markdown)
disk-clean scan C:\ D:\

# 2. Read the report (terminal summary + Markdown render)
disk-clean report

# 3. Generate an organize plan (loose dirs → <drive>:\整理区\<category>\)
disk-clean organize plan

# ...also include program/game dirs (⚠ moves will rewrite shortcuts)
disk-clean organize plan --include-program

# 4. Preview, then actually move (dry-run by default; --yes to run)
disk-clean organize apply
disk-clean organize apply --yes

# 5. Undo the last batch (moves + shortcuts restored)
disk-clean organize rollback --yes

# 6. Clean junk (temp / empty dirs / duplicates / recycle bin)
disk-clean clean empty-dirs              # preview
disk-clean clean empty-dirs --yes        # execute (moves to recycle bin)

# 7. Fix broken shortcuts manually
disk-clean fix-shortcuts pairs.json

# 8. View the audit log
disk-clean audit

# 9. Fast MFT scan (needs admin, ~8x faster than traversal)
disk-clean mftscan D:

# 10. Full-disk duplicate detection (excludes system/program dirs)
disk-clean dedup D:\

# 11. Merge duplicates into hardlinks to free space (rollback-able)
disk-clean dedup D:\ --hardlink --yes
disk-clean dedup rollback

# 12. Per-user quota analysis (needs admin)
disk-clean quota C:

# 13. SMART / SSD health check
disk-clean health

# 14. Create a system restore point before destructive ops
disk-clean organize apply --yes --restore-point

# 15. English report
disk-clean scan D:\ --lang en

# 16. Start the MCP server (for AI clients; stdio, long-running)
disk-clean mcp
```

---

## Commands

| Command | Description |
|---|---|
| `scan [roots...]` | Full scan with smart suggestions (loose dirs, duplicates, stale large files, junk, empty dirs). Emits `report.json` + `report.md`. |
| `report [file]` | Render a saved report (terminal + Markdown). |
| `organize plan` | Generate organize plan: loose dirs → `<drive>:\整理区\<category>\`. `--include-program` adds program/game dirs with a shortcut-fix warning. |
| `organize apply [file]` | Execute a plan. **Dry-run unless `--yes`.** Program dirs require `fixShortcuts`; shortcuts are rewritten and restored on rollback. |
| `organize rollback` | Undo the last batch (moves + shortcuts). **Dry-run unless `--yes`.** |
| `clean <type> [paths...]` | `junk-temp` \| `empty-dirs` \| `duplicates` \| `recycle-bin`. **Dry-run unless `--yes`.** Items go to the recycle bin (recoverable); only recycle-bin emptying is permanent. |
| `fix-shortcuts <pairs.json>` | Rewrite `.lnk` files pointing at moved paths (Desktop / Start Menu / Taskbar). |
| `audit` | Show the JSONL audit log. |
| `config` | Rules config: whitelist/blacklist, thresholds, retention. |
| `schedule` | Scheduled scans via Windows Task Scheduler. |
| `mftscan <drive>` | **Experimental:** raw NTFS MFT scan (needs admin) — ~8x faster than directory traversal; parses fragmented $MFT runlists, rebuilds full paths, sizes via alloc/real rule. |
| `dedup [roots...]` | Full-disk duplicate detection (excludes system/program dirs; head/tail + full-hash strategy). `--hardlink --yes` merges duplicates into hardlinks; `dedup rollback` restores. |
| `quota [drive]` | Per-user quota analysis via MFT (needs admin): users ranked + per-user Downloads/Documents/Desktop/... breakdown. |
| `health` | SMART / SSD health: temperature, wear %, power-on hours, read/write errors with a health grade. |
| `mcp` | Start the **MCP server** (stdio, 12 tools) for DeepSeek Harness / Claude Desktop / Cursor and any other MCP client. stdout carries protocol messages only; diagnostics go to stderr. |
| `--restore-point` | Add to `clean` / `organize apply` to create a system restore point first (fails gracefully if protection is off). |
| `--lang en\|zh` | Report language for `scan` (auto-detected; defaults to system language). |

---

## Safety model

- **Dry-run by default** — every destructive command prints what it *would* do; pass `--yes` to actually run.
- **Recycle bin** — junk/empty/duplicate items are moved to the recycle bin, not permanently deleted.
- **Rollback** — directory moves append to `organize-map.json`; `organize rollback` restores the last batch (including shortcuts).
- **Protected paths** — 16 protected segments are always refused: `\windows\`, `\windows.old\`, `\program files*\`, `\programdata\`, `\winsxs\`, `\system volume information\`, `\$recycle.bin\`, `\$windows.~bt\`, `\$windows.~ws\`, `\recovery\`, `\perflogs\`, `\msocache\`, `\config.msi\`, `\boot\`, `\efi\`. The list exists in exactly one place (`lib/guard.js`).
- **OneDrive cloud sync** — paths containing a `\OneDrive\` segment are refused for destructive operations too (deleting syncs to the cloud; hashing triggers silent placeholder downloads).
- **Audit log** — every action is appended to `~/.disk-clean/audit.jsonl` (time / type / paths / result / real item counts).
- **Exit codes** — 0 ok · 1 user cancel/args · 2 runtime error · 3 scan cancelled.

State files live in `~/.disk-clean/`:
```
audit.jsonl            # audit log
report.json / .md      # latest report
organize-map.json      # rollback mapping
organize-plan.json     # last plan
```

---

## Example output

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
✔ 扫描完成  (5.5s)   ← ~8x faster than traversal
  D:  总大小: 532 GB  文件: 1362274  目录: 196450

▶ 全盘重复检测: D:\
✔ 扫描完成  (35.1s)  重复组: 1503  可释放: 17.3 GB

▶ 配额分析: C:
  administrator   1.1 TB  (74.9%)
      ├ Desktop  77.8 GB
      ├ AppData  875 GB
```

See [docs/demo-report.md](docs/demo-report.md) for a full Markdown report sample.

---

## Development

```powershell
npm run check     # syntax check all modules
npm test          # full suite (11 suites, incl. MCP protocol + rules integrity + safety gates)
npm run mcp       # start an MCP server locally
powershell -File scripts\build.ps1   # build exe + sha256
```

- Engine: `lib/engine-core.js` (the only editable core) → `lib/engine.js` (thin wrapper) — zero-dependency Node (native `fs`), PowerShell used only for COM shortcut fixing.
- Safety gate: `lib/guard.js` (single source). Version: `lib/version.js` (single source).
- MCP: `lib/mcp/server.js` (protocol core, zero-dependency) + `lib/mcp/tools.js` (12 tools, all thin wrappers over `lib/*`).
- The CLI and the MCP server are both thin shells — there is no second copy of the business logic.

## Reusable process

See [docs/RELEASE-PLAYBOOK.md](docs/RELEASE-PLAYBOOK.md) — the step-by-step SOP for building the CLI/GUI, publishing to GitHub and npm, and shipping Release assets (reuse for new projects). GUI specifics live in the `gui-development` skill; release specifics in `release-sop`.

## Roadmap

See [ROADMAP.md](ROADMAP.md) — 12 phases: config rules, scheduled scans, MFT fast scan, SMART health, full-disk dedup, per-user quota, restore points, i18n.

## License

[MIT](LICENSE)
