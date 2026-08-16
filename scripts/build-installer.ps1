# build-installer.ps1 - Build the disk-clean GUI installer (Inno Setup)
# Steps: publish C# shell (single-file, framework-dependent) -> assemble stage/
#        -> build engine SEA exe -> run ISCC to produce installer in gui\dist\
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$Version = (Get-Content (Join-Path $root "package.json") -Raw | ConvertFrom-Json).version
if (-not $Version) { $Version = "0.3.0" }
$stage = Join-Path $root "gui\stage"
$dist  = Join-Path $root "gui\dist"
$iscc  = "C:\Users\Administrator\AppData\Local\Programs\Inno Setup 6\ISCC.exe"
if (-not (Test-Path $iscc)) {
  $cand = Get-ChildItem "$env:LOCALAPPDATA\Programs","C:\Program Files (x86)","C:\Program Files" -Filter ISCC.exe -Recurse -Depth 3 -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $cand) { throw "ISCC.exe not found - install Inno Setup 6 first" }
  $iscc = $cand.FullName
}

Write-Host "==> 0/5 regenerate app icon (gui\shell\app.ico + favicon source) ..." -ForegroundColor Cyan
powershell -ExecutionPolicy Bypass -File scripts\make-icon.ps1
if ($LASTEXITCODE -ne 0) { throw "make-icon failed" }

Write-Host "==> 1/5 publish C# shell (framework-dependent single exe) ..." -ForegroundColor Cyan
dotnet publish gui\shell\DiskCleanUi.csproj -c Release -r win-x64 --self-contained false -p:PublishSingleFile=true -o $stage
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed" }

Write-Host "==> 2/5 build engine SEA exe (with --serve) ..." -ForegroundColor Cyan
powershell -ExecutionPolicy Bypass -File scripts\build-sea.ps1
if ($LASTEXITCODE -ne 0) { throw "build-sea failed" }

Write-Host "==> 3/5 assemble stage ..." -ForegroundColor Cyan
Copy-Item (Join-Path $root "dist\disk-clean-win-x64.exe") (Join-Path $stage "engine.exe") -Force
Copy-Item (Join-Path $root "LICENSE") (Join-Path $stage "LICENSE") -Force
New-Item -ItemType Directory -Force -Path (Join-Path $stage "web") | Out-Null
Copy-Item (Join-Path $root "gui\web\*") (Join-Path $stage "web\") -Force

Write-Host "==> 4/5 iscc compile ..." -ForegroundColor Cyan
& $iscc (Join-Path $root "installer\disk-clean-ui.iss")
if ($LASTEXITCODE -ne 0) { throw "iscc failed" }

Write-Host "==> 5/5 checksums ..." -ForegroundColor Cyan
$setup = Get-ChildItem (Join-Path $dist "disk-clean-setup-$Version.exe") -ErrorAction SilentlyContinue
if (-not $setup) { $setup = Get-ChildItem (Join-Path $dist "*.exe") | Sort-Object LastWriteTime -Descending | Select-Object -First 1 }
$hash = (Get-FileHash -Algorithm SHA256 $setup.FullName).Hash.ToLower()
[System.IO.File]::WriteAllText("$($setup.FullName).sha256", "$hash  $($setup.Name)`n", (New-Object System.Text.UTF8Encoding($false)))

Write-Host "==> build complete ==" -ForegroundColor Green
Write-Host ("installer: {0}  ({1:N1} MB)" -f $setup.FullName, ($setup.Length / 1MB))
Write-Host ("sha256   : {0}" -f $hash)
$exe2 = Join-Path $stage "disk-clean-ui.exe"
Write-Host ("shell    : {0}  ({1:N1} MB)" -f $exe2, ((Get-Item $exe2).Length / 1MB))