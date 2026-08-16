# disk-clean

> **English** | [**简体中文**](README.zh-CN.md)

**Windows disk cleanup & analysis CLI** — scan, classify, suggest, safely organize (with automatic shortcut fixing) and clean your disks. Zero runtime dependencies, works offline.

> ⚠️ Safety first: every destructive command is **dry-run by default**. Nothing is moved or deleted unless you pass `--yes`. Moves are logged and rollback-able.

---

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
| Open source, no telemetry, no ads | ✅ | ✅ | ❌ | ❌ |
| AI integration (optional, via DSH) | ✅ (plugin) | ❌ | ❌ | ❌ |

---

## Install

### Option A — single EXE (recommended)

Download `disk-clean-win-x64.exe` from [Releases](https://github.com/ShuiQiongChuYunQiShi/disk-clean-cli/releases) — no Node.js required.

```powershell
.\disk-clean-win-x64.exe scan D:\
```

### Option B — via Node.js (>= 14.16)

```powershell
npm install -g disk-clean    # or: git clone + npm link
disk-clean scan D:\
```

### Option C — DeepSeek Harness plugin (AI-driven)

The same engine also ships as a DSH agent preset (`disk-analyzer`) with natural-language control and a live chart panel. See [plugin/README.md](plugin/README.md).

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
| `--restore-point` | Add to `clean` / `organize apply` to create a system restore point first (fails gracefully if protection is off). |
| `--lang en\|zh` | Report language for `scan` (auto-detected; defaults to system language). |

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
npm run smoke     # engine smoke test
powershell -File scripts\build.ps1   # build exe + sha256
```

- Engine: `lib/engine.js` — zero-dependency Node (native `fs`), PowerShell used only for COM shortcut fixing.
- The CLI is a thin wrapper; the engine is also embedded in the DSH plugin form.

## Reusable process

See [docs/RELEASE-PLAYBOOK.md](docs/RELEASE-PLAYBOOK.md) — the step-by-step SOP for building the DSH plugin + CLI, publishing to GitHub and shipping Release assets (reuse for new projects). Historical retrospective and error catalog: [docs/PROCESS-REVIEW.md](docs/PROCESS-REVIEW.md).

## Roadmap

See [ROADMAP.md](ROADMAP.md) — 12 phases: config rules, scheduled scans, MFT fast scan, SMART health, full-disk dedup, per-user quota, restore points, i18n.

## License

[MIT](LICENSE)
