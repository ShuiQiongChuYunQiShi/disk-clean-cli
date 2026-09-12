# build-sea.ps1 - Build single-file EXE via Node SEA (no external base binary, offline-friendly)
# Prereq: npm install --save-dev esbuild postject
# Output: dist\disk-clean-win-x64.exe + .sha256 + checksums.txt
param(
  [string]$Version = ""
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
if (-not $Version) {
  try { $Version = (Get-Content (Join-Path $root "package.json") -Raw | ConvertFrom-Json).version } catch { $Version = "0.0.0" }
}

# Build fingerprint (S9). The exe carries "which commit produced me" so a published
# artifact can be asserted against the source tree; without it, "built before the last
# edit" is invisible and a stale binary ships as the new version.
# esbuild --define keeps the repository free of generated files: plain `node` runs see
# no define at all and fall back to a null fingerprint (see lib/version.js).
$commit = "unknown"
$dirtyFlag = "false"
try {
  $commit = (git rev-parse --short HEAD 2>$null | Out-String).Trim()
  if (-not $commit) { $commit = "unknown" }
  $porcelain = (git status --porcelain 2>$null | Out-String).Trim()
  if ($porcelain) { $dirtyFlag = "true" }
} catch { $commit = "unknown" }
$builtAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$marked = "$Version+$commit"
if ($dirtyFlag -eq "true") { $marked = "$marked-dirty" }

Write-Host "==> 1/4 esbuild bundle + build fingerprint ..." -ForegroundColor Cyan
Write-Host "    fingerprint: $marked  builtAt: $builtAt"
node scripts\build-bundle.js --outfile dist\sea-bundle.js --commit $commit --dirty $dirtyFlag --built-at $builtAt
if ($LASTEXITCODE -ne 0) { throw "bundle/fingerprint failed" }

Write-Host "==> 2/4 generate SEA blob ..." -ForegroundColor Cyan
node --experimental-sea-config sea-config.json
if ($LASTEXITCODE -ne 0) { throw "SEA config failed" }

Write-Host "==> 3/4 copy node.exe + postject inject ..." -ForegroundColor Cyan
$nodeExe = (Get-Command node).Source
Copy-Item $nodeExe dist\disk-clean-win-x64.exe -Force
npx postject dist\disk-clean-win-x64.exe NODE_SEA_BLOB dist\sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
if ($LASTEXITCODE -ne 0) { throw "postject failed" }

# The fingerprint must survive into the binary. Assert against the real exe instead of
# trusting the toolchain: this is the artifact that gets published, so this is the only
# place where "the fingerprint is really in there" can be established.
$probe = (& (Join-Path $root "dist\disk-clean-win-x64.exe") build-info | Out-String).Trim()
if ($probe -notmatch [regex]::Escape($commit)) {
  throw "build fingerprint missing from the exe: build-info returned '$probe' (expected commit $commit)"
}
Write-Host "    exe build-info: $probe"

Write-Host "==> 4/4 checksums ..." -ForegroundColor Cyan
$exe = Join-Path $root "dist\disk-clean-win-x64.exe"
$hash = (Get-FileHash -Algorithm SHA256 $exe).Hash.ToLower()
[System.IO.File]::WriteAllText("$exe.sha256", "$hash  disk-clean-win-x64.exe`n", (New-Object System.Text.UTF8Encoding($false)))
[System.IO.File]::WriteAllText((Join-Path $root "dist\checksums.txt"), "disk-clean-win-x64.exe  sha256=$hash  size=$((Get-Item $exe).Length)  version=$Version  commit=$commit`n", (New-Object System.Text.UTF8Encoding($false)))

Write-Host "==> build complete ==" -ForegroundColor Green
Write-Host ("exe    : $exe  ({0:N1} MB)" -f ((Get-Item $exe).Length / 1MB))
Write-Host ("sha256 : $hash")
Write-Host ("mark   : $marked")
