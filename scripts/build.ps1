# build.ps1 — 构建 Release 资产
# 用法: powershell -ExecutionPolicy Bypass -File scripts\build.ps1 [version]
# 产出: dist\disk-clean-win-x64.exe + dist\disk-clean-win-x64.exe.sha256 + dist\checksums.txt
param(
  [string]$Version = "0.1.0"
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "==> 打包 exe (pkg) ..." -ForegroundColor Cyan
npx pkg bin\disk-clean.js --targets node22-win-x64 --output dist\disk-clean-win-x64.exe
if ($LASTEXITCODE -ne 0) { throw "pkg 打包失败" }

$exe = Join-Path $root "dist\disk-clean-win-x64.exe"
if (-not (Test-Path $exe)) { throw "exe 未生成" }
$size = (Get-Item $exe).Length

Write-Host "==> 计算 SHA256 ..." -ForegroundColor Cyan
$hash = (Get-FileHash -Algorithm SHA256 $exe).Hash.ToLower()
[System.IO.File]::WriteAllText("$exe.sha256", "$hash  disk-clean-win-x64.exe`n", (New-Object System.Text.UTF8Encoding($false)))
[System.IO.File]::WriteAllText((Join-Path $root "dist\checksums.txt"), "disk-clean-win-x64.exe  sha256=$hash  size=$size  version=$Version`n", (New-Object System.Text.UTF8Encoding($false)))

Write-Host "==> 构建完成 ==" -ForegroundColor Green
Write-Host ("exe    : $exe  ({0:N1} MB)" -f ($size / 1MB))
Write-Host ("sha256 : $hash")
Write-Host "checksums.txt 已生成"
