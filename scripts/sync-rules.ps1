# sync-rules.ps1 - Sync lib/rules.js to all plugin copies (product/install/repo) and verify MD5.
# Source of truth: lib/rules.js. Edit that file, then run this script.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$src = Join-Path $root 'lib\rules.js'
if (-not (Test-Path $src)) { Write-Error "Not found: $src"; exit 1 }

$dsts = @(
  'plugin\plugins\dsk-rules.js',
  'plugin\plugins\disk-analyzer\dsk-rules.js'
)

# windowsClear product (dev source)
$wcRoot = 'D:\deepseekHerness\windowsClear\product\disk-analyzer\plugins'
$wcTargets = @(
  (Join-Path $wcRoot 'dsk-rules.js'),
  (Join-Path $wcRoot 'disk-analyzer\dsk-rules.js')
)
foreach ($t in $wcTargets) {
  New-Item -ItemType Directory -Force -Path (Split-Path $t) | Out-Null
  Copy-Item $src $t -Force
  Write-Output "synced -> $t"
}

# repo plugin dir
foreach ($rel in $dsts) {
  $dst = Join-Path $root $rel
  New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null
  Copy-Item $src $dst -Force
  Write-Output "synced -> $dst"
}

# install preset (current user)
$installTargets = @(
  "$env:USERPROFILE\.dsh\.agent-presets\disk-analyzer\plugins\dsk-rules.js",
  "$env:USERPROFILE\.dsh\.agent-presets\disk-analyzer\plugins\disk-analyzer\dsk-rules.js"
)
foreach ($t in $installTargets) {
  if (Test-Path (Split-Path $t)) {
    Copy-Item $src $t -Force
    Write-Output "synced -> $t"
  }
}

# verify
$srcHash = (Get-FileHash $src -Algorithm MD5).Hash
$allOk = $true
$allTargets = @()
$allTargets += $wcTargets
foreach ($rel in $dsts) { $allTargets += (Join-Path $root $rel) }
$allTargets += $installTargets
foreach ($t in $allTargets) {
  if (Test-Path $t) {
    $h = (Get-FileHash $t -Algorithm MD5).Hash
    if ($h -ne $srcHash) { $allOk = $false; Write-Warning "MD5 mismatch: $t" }
  }
}
if ($allOk) { Write-Output "All MD5 match: $srcHash" } else { exit 1 }
