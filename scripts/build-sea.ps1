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

Write-Host "==> 1/4 esbuild bundle ..." -ForegroundColor Cyan
npx esbuild bin\disk-clean.js --bundle --platform=node --format=cjs --outfile=dist\sea-bundle.js
if ($LASTEXITCODE -ne 0) { throw "esbuild failed" }

Write-Host "==> 2/4 generate SEA blob ..." -ForegroundColor Cyan
node --experimental-sea-config sea-config.json
if ($LASTEXITCODE -ne 0) { throw "SEA config failed" }

Write-Host "==> 3/4 copy node.exe + postject inject ..." -ForegroundColor Cyan
$nodeExe = (Get-Command node).Source
Copy-Item $nodeExe dist\disk-clean-win-x64.exe -Force
npx postject dist\disk-clean-win-x64.exe NODE_SEA_BLOB dist\sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
if ($LASTEXITCODE -ne 0) { throw "postject failed" }

Write-Host "==> 4/4 checksums ..." -ForegroundColor Cyan
$exe = Join-Path $root "dist\disk-clean-win-x64.exe"
$hash = (Get-FileHash -Algorithm SHA256 $exe).Hash.ToLower()
[System.IO.File]::WriteAllText("$exe.sha256", "$hash  disk-clean-win-x64.exe`n", (New-Object System.Text.UTF8Encoding($false)))
[System.IO.File]::WriteAllText((Join-Path $root "dist\checksums.txt"), "disk-clean-win-x64.exe  sha256=$hash  size=$((Get-Item $exe).Length)  version=$Version`n", (New-Object System.Text.UTF8Encoding($false)))

Write-Host "==> build complete ==" -ForegroundColor Green
Write-Host ("exe    : $exe  ({0:N1} MB)" -f ((Get-Item $exe).Length / 1MB))
Write-Host ("sha256 : $hash")
