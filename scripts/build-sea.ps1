# build-sea.ps1 — 用 Node SEA 构建单文件 exe（无需外部 base binary，离线可用）
# 前置: npm install --save-dev esbuild postject
# 产出: dist\disk-clean-win-x64.exe + .sha256 + checksums.txt
param(
  [string]$Version = "0.1.0"
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "==> 1/4 esbuild bundle ..." -ForegroundColor Cyan
npx esbuild bin\disk-clean.js --bundle --platform=node --format=cjs --outfile=dist\sea-bundle.js
if ($LASTEXITCODE -ne 0) { throw "esbuild 失败" }

Write-Host "==> 2/4 生成 SEA blob ..." -ForegroundColor Cyan
node --experimental-sea-config sea-config.json
if ($LASTEXITCODE -ne 0) { throw "SEA config 失败" }

Write-Host "==> 3/4 复制 node.exe + postject 注入 ..." -ForegroundColor Cyan
$nodeExe = (Get-Command node).Source
Copy-Item $nodeExe dist\disk-clean-win-x64.exe -Force
npx postject dist\disk-clean-win-x64.exe NODE_SEA_BLOB dist\sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
if ($LASTEXITCODE -ne 0) { throw "postject 失败" }

Write-Host "==> 4/4 校验和 ..." -ForegroundColor Cyan
$exe = Join-Path $root "dist\disk-clean-win-x64.exe"
$hash = (Get-FileHash -Algorithm SHA256 $exe).Hash.ToLower()
[System.IO.File]::WriteAllText("$exe.sha256", "$hash  disk-clean-win-x64.exe`n", (New-Object System.Text.UTF8Encoding($false)))
[System.IO.File]::WriteAllText((Join-Path $root "dist\checksums.txt"), "disk-clean-win-x64.exe  sha256=$hash  size=$((Get-Item $exe).Length)  version=$Version`n", (New-Object System.Text.UTF8Encoding($false)))

Write-Host "==> 构建完成 ==" -ForegroundColor Green
Write-Host ("exe    : $exe  ({0:N1} MB)" -f ((Get-Item $exe).Length / 1MB))
Write-Host ("sha256 : $hash")
