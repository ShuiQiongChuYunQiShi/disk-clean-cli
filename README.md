# disk-clean

**Windows disk cleanup & analysis CLI** — scan, classify, suggest, safely organize (with automatic shortcut fixing) and clean your disks. Zero runtime dependencies, works offline.

> ⚠️ Safety first: every destructive command is **dry-run by default**. Nothing is moved or deleted unless you pass `--yes`. Moves are logged and rollback-able.

---

## Why disk-clean?

| Feature | disk-clean | WizTree | CCleaner | 360/火绒 |
|---|---|---|---|---|
| Fast scan (MFT: WIP) | ✅ (v1.1) | ✅ | ❌ | ✅ |
| Move dirs to `整理区` with **rollback** | ✅ | ❌ | ❌ | ❌ |
| **Rewrite desktop/start-menu shortcuts** after moving program dirs | ✅ (unique) | ❌ | ❌ | ❌ |
| Duplicate detection (user zones, hash-based) | ✅ | ❌ | ✅ | ✅ |
| Audit log (JSONL) of every action | ✅ | ❌ | ❌ | ❌ |
| Readable **Markdown report** | ✅ | ❌ | ❌ | ❌ |
| Recycle-bin safety (not permanent delete) | ✅ | ❌ | ✅ | ✅ |
| Open source, no telemetry, no ads | ✅ | ✅ | ❌ | ❌ |
| AI integration (optional, via DSH) | ✅ (plugin) | ❌ | ❌ | ❌ |

---

## Install

### Option A — single EXE (recommended)

Download `disk-clean-win-x64.exe` from [Releases](../../releases) — no Node.js required.

```powershell
.\disk-clean-win-x64.exe scan D:\
```

### Option B — via Node.js (>= 14.16)

```powershell
npm install -g disk-clean    # or: git clone + npm link
disk-clean scan D:\
```

### Option C — DeepSeek Harness plugin (AI-driven)

The same engine also ships as a DSH agent preset (`disk-analyzer`) with natural-language control and a live chart panel. See the [plugin README](../README.md).

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
| `config` | *(v1.1)* Rules config: whitelist/blacklist, thresholds, retention. |
| `schedule` | *(v1.1)* Scheduled scans via Windows Task Scheduler. |
| `health` | *(v1.1)* SMART / SSD wear check. |

---

## Safety model

- **Dry-run by default** — every destructive command prints what it *would* do; pass `--yes` to actually run.
- **Recycle bin** — junk/empty/duplicate items are moved to the recycle bin, not permanently deleted.
- **Rollback** — directory moves append to `organize-map.json`; `organize rollback` restores the last batch (including shortcuts).
- **Protected paths** — `\windows\`, `\program files*\`, `\programdata\`, `\winsxs\`, `\system volume information\`, `\$recycle.bin\` are always refused.
- **Audit log** — every action is appended to `~/.disk-clean/audit.jsonl` (time / type / paths / result).
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
✔ 扫描完成  (60.4s)
  根目录   : D:\
  总大小   : 1.2 TB
  文件     : 412330  目录: 152201  空目录: 4490
  报告     : C:\Users\Administrator\.disk-clean\report.json
  Markdown : C:\Users\Administrator\.disk-clean\report.md

── 智能建议 ──
  [organize-folders] 目录整理建议 — 13 项 (164.0 GB)
  [stale-large] 清理长期未使用的大文件 — 14 项 (15.4 GB)
  [created-old] 创建时间久远的历史目录 — 15 项 (14.7 GB)
  [duplicates] 重复文件 — 46 组 (可释放约 110 MB)
  [recycle-bin] 清空回收站 — 67 MB
  [junk-temp] 清理临时与缓存文件 — 3 KB
  [empty-dirs] 删除空文件夹 — 4490 项
```

See [docs/demo-report.md](docs/demo-report.md) for a full Markdown report sample.

---

## Development

```powershell
npm run check     # syntax check all modules
npm run smoke     # engine smoke test
powershell -File scripts\build.ps1   # build exe + sha256
```

- Engine: `lib/engine.js` — zero-dependency Node (native `fs`), PowerShell used only for COM shortcut fixing.
- The CLI is a thin wrapper; the engine is also embedded in the DSH plugin form.

## Roadmap

See [ROADMAP.md](ROADMAP.md) — 12 phases: config rules, scheduled scans, MFT fast scan, SMART health, full-disk dedup, per-user quota, restore points, i18n.

## License

[MIT](LICENSE)
