# disk-clean v0.2.0 — Release Notes

**Windows disk cleanup & analysis CLI.** Zero runtime dependencies, single-file EXE, dry-run by default, rollback-able moves, and full audit logging.

## Highlights since v0.1.0

- **🚀 MFT raw scan** (`mftscan D:`, admin required): parses the fragmented NTFS $MFT (runlists, path rebuild, alloc/real size rules). **Measured ~8x faster** than directory traversal: 5.5s vs 43.1s on a 1.5M-record volume, with file/dir counts matching traversal at 99%/100%.
- **♻️ Full-disk dedup** (`dedup [roots...]`): head/tail + full-hash duplicate detection across all drives (system/program dirs excluded). Real run on D: found **1503 duplicate groups, ~17.3 GB reclaimable** (WeChat backups, duplicate installers, torch DLLs across venvs). Optional `--hardlink --yes` merges duplicates into hardlinks with `dedup rollback` support.
- **👥 Per-user quota** (`quota C:`, admin): MFT-based per-user usage ranking with per-folder breakdown (Downloads/Documents/Desktop/AppData…).
- **💊 SMART / SSD health** (`health`): temperature, wear %, power-on hours, read/write errors, health grade (Healthy / Watch / Warning / Critical).
- **⏰ Scheduled scans** (`schedule add|run|list|remove`): Windows Task Scheduler integration with report archiving.
- **🛡️ Restore points** (`--restore-point`): optional system restore point before destructive ops; degrades gracefully when protection is off.
- **🌐 i18n reports** (`--lang en|zh`): bilingual Markdown reports with language auto-detection.
- **⚙️ Rules config** (`config`): thresholds, exclude whitelist, retention.

## Install

Download `disk-clean-win-x64.exe` (82 MB, no Node.js required) from the assets below and run:

```powershell
.\disk-clean-win-x64.exe scan D:\
```

## Safety

- **Dry-run by default** — destructive commands only act with `--yes`.
- Items go to the **recycle bin** (recoverable) unless you explicitly empty it.
- Directory moves are **rollback-able** (incl. shortcut rewrites).
- Protected system paths are always refused; every action is written to the audit log.

## SHA-256

See the checksum file attached to this release.
