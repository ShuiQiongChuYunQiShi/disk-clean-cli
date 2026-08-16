# Contributing

Thanks for your interest in disk-clean! All contributions are welcome.

## Development setup

```powershell
git clone <your-fork>
cd disk-clean
npm install            # dev deps: esbuild, postject
npm run check          # syntax check all modules
npm run smoke          # engine smoke test (scans test/ tree data)
```

## Project layout

```
bin/disk-clean.js    CLI entry (also has --internal-scan self-spawn mode for SEA)
lib/engine.js        zero-dependency scan/analysis engine (native fs)
lib/organize.js      organize plan/apply/rollback + shortcut fixing
lib/clean.js         junk cleanup (recycle-bin safe)
lib/audit.js         audit log + state files (~/.disk-clean/)
scripts/build-sea.ps1  single-file exe build (Node SEA)
docs/                demo outputs
test/                smoke tests
```

## Rules

- **Zero runtime dependencies.** Everything must run with Node built-ins only (PowerShell is used for COM shortcut fixing, never for core scanning).
- **Safety first.** Every destructive path must be dry-run by default, require `--yes`, write to the audit log, and be rollback-able. Protected system paths must always be refused.
- Keep messages in Chinese **and** English where user-facing (i18n work in progress, see ROADMAP Phase 11).
- Run `npm run check` and `npm run smoke` before committing.

## Reporting issues

- **Bug**: include the command run, the report JSON (paths only), and expected vs actual.
- **Feature**: describe the scenario, why it matters, and rough acceptance criteria.
- Security issues: do NOT open a public issue; describe the problem in a private note (the tool moves/deletes user data — treat every safety bug as high priority).

## Building the release exe

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-sea.ps1
# → dist\disk-clean-win-x64.exe + .sha256 + checksums.txt
```
