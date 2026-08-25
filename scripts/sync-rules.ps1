# sync-rules.ps1 - Sync lib/rules.js AND lib/engine-core.js artifacts to all plugin copies
# Sources of truth: lib/rules.js, lib/engine-core.js. Edit those, then run this script.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$srcRules = Join-Path $root 'lib\rules.js'
$srcCore = Join-Path $root 'lib\engine-core.js'
if (-not (Test-Path $srcRules)) { Write-Error "Not found: $srcRules"; exit 1 }
if (-not (Test-Path $srcCore)) { Write-Error "Not found: $srcCore"; exit 1 }

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
  Copy-Item $srcRules $t -Force
  Write-Output "synced -> $t"
}

# repo plugin dir
foreach ($rel in $dsts) {
  $dst = Join-Path $root $rel
  New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null
  Copy-Item $srcRules $dst -Force
  Write-Output "synced -> $dst"
}

# install preset (current user)
$installTargets = @(
  "$env:USERPROFILE\.dsh\.agent-presets\disk-analyzer\plugins\dsk-rules.js",
  "$env:USERPROFILE\.dsh\.agent-presets\disk-analyzer\plugins\disk-analyzer\dsk-rules.js"
)
foreach ($t in $installTargets) {
  if (Test-Path (Split-Path $t)) {
    Copy-Item $srcRules $t -Force
    Write-Output "synced -> $t"
  }
}

# verify rules
$srcHash = (Get-FileHash $srcRules -Algorithm MD5).Hash
$allOk = $true
$allTargets = @()
$allTargets += $wcTargets
foreach ($rel in $dsts) { $allTargets += (Join-Path $root $rel) }
$allTargets += $installTargets
foreach ($t in $allTargets) {
  if (Test-Path $t) {
    $h = (Get-FileHash $t -Algorithm MD5).Hash
    if ($h -ne $srcHash) { $allOk = $false; Write-Warning "MD5 mismatch (rules): $t" }
  }
}
if ($allOk) { Write-Output "All MD5 match (rules): $srcHash" } else { exit 1 }

# --- engine-core artifacts (generated with DO NOT EDIT header) ---
$header = "// THIS FILE IS GENERATED FROM lib/engine-core.js - DO NOT EDIT`n// Source: lib/engine-core.js`n"
$coreContent = Get-Content $srcCore -Raw -Encoding UTF8
$hash12 = (Get-FileHash $srcCore -Algorithm SHA256).Hash.Substring(0,12)
$withHeader = $header.Replace("DO NOT EDIT", "DO NOT EDIT ($hash12)") + $coreContent
$coreTargets = @(
  (Join-Path $root 'plugin\plugins\dsk-engine-core.js'),
  (Join-Path $root 'plugin\plugins\disk-analyzer\dsk-engine-core.js'),
  'D:\deepseekHerness\windowsClear\product\disk-analyzer\plugins\dsk-engine-core.js',
  'D:\deepseekHerness\windowsClear\product\disk-analyzer\plugins\disk-analyzer\dsk-engine-core.js',
  "$env:USERPROFILE\.dsh\.agent-presets\disk-analyzer\plugins\dsk-engine-core.js",
  "$env:USERPROFILE\.dsh\.agent-presets\disk-analyzer\plugins\disk-analyzer\dsk-engine-core.js"
)
foreach ($t in $coreTargets) {
  if (-not (Test-Path (Split-Path $t))) { continue }
  New-Item -ItemType Directory -Force -Path (Split-Path $t) | Out-Null
  [System.IO.File]::WriteAllText($t, $withHeader, (New-Object System.Text.UTF8Encoding($false)))
  Write-Output "generated -> $t"
}
Write-Output "All MD5 match (rules): $srcHash + engine-core artifacts generated"
