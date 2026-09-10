# publish-release.ps1 - One-command GitHub Release publish
# Usage: powershell -File scripts\publish-release.ps1 <ver> [-PublishNpm]
#   e.g. powershell -File scripts\publish-release.ps1 0.5.0 -PublishNpm
# Requires: $env:GH_TOKEN (fine-grained PAT with **Contents: Read and write**),
#           gh at C:\Program Files\GitHub CLI\gh.exe or in PATH
#
# METHOD: validate every step explicitly and exit 1 on the first failure.
# The previous version created nothing (release create returned 403, asset upload
# said "release not found") yet printed "Publish verified: v0.5.0" and exited 0
# (issue G51). A false success is worse than a failure: it makes everyone believe
# the release shipped. So key steps are re-checked against the API instead of
# trusting a single command's exit code.
#
# IRON RULE: this file is ALL ASCII. PowerShell 5.1 reads a BOM-less UTF-8 file
# as ANSI/GBK, which corrupts non-ASCII text into parser errors (issue G46).
param([string]$ver, [switch]$PublishNpm)
$ErrorActionPreference = 'Continue'   # native stderr noise must not become a terminating error
if (-not $ver) { Write-Error "Usage: publish-release.ps1 <ver>  e.g. 0.5.0"; exit 1 }
if ($ver -notmatch '^\d+\.\d+\.\d+$') { Write-Error "Version must be x.y.z"; exit 1 }

$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
$gh = "C:\Program Files\GitHub CLI\gh.exe"
if (-not (Test-Path $gh)) { $gh = "gh" }
if (-not $env:GH_TOKEN) { Write-Error "GH_TOKEN not set"; exit 1 }

$tag = "v$ver"
$repo = "ShuiQiongChuYunQiShi/disk-clean-cli"
$apiHeaders = @{ Authorization = "Bearer $env:GH_TOKEN"; "User-Agent" = "dsh"; Accept = "application/vnd.github+json" }

function Fail($msg) { Write-Error $msg; exit 1 }

# Wrapper for native commands: returns @{ code; out } and never throws on stderr noise.
function RunNative($file, $argList) {
  $out = & $file @argList 2>&1 | Out-String
  return @{ code = $LASTEXITCODE; out = $out }
}

function GetRelease($tagName) {
  try {
    return Invoke-RestMethod "https://api.github.com/repos/$repo/releases/tags/$tagName" -Headers $apiHeaders -TimeoutSec 30 -ErrorAction Stop
  } catch {
    return $null
  }
}

# ---------- 0) Preflight: repo reachable with this token ----------
Write-Output "==> 0/6 preflight..."
try {
  $null = Invoke-RestMethod "https://api.github.com/repos/$repo" -Headers $apiHeaders -TimeoutSec 30 -ErrorAction Stop
} catch {
  Fail "Cannot read repo $repo with this token: $($_.Exception.Message)"
}
Write-Output "token can read $repo"

# ---------- 1) Ensure the tag exists and is pushed ----------
Write-Output "==> 1/6 tag $tag ..."
$hasTag = ((git tag -l $tag) | Out-String).Trim()
if (-not $hasTag) {
  Write-Output "creating local tag $tag"
  $r = RunNative 'git' @('tag', $tag)
  if ($r.code -ne 0) { Fail "git tag failed: $($r.out)" }
}
$remoteTag = ((git ls-remote --tags origin $tag 2>$null) | Out-String).Trim()
if (-not $remoteTag) {
  Write-Output "pushing tag $tag"
  $r = RunNative 'git' @('push', 'origin', $tag)
  if ($r.code -ne 0) { Fail "git push tag failed: $($r.out)" }
}
Write-Output "tag $tag is on the remote"

# ---------- 2) Create the Release (non-draft); skip when it already exists ----------
Write-Output "==> 2/6 release..."
$release = GetRelease $tag
if ($release) {
  Write-Output "release $tag already exists (id=$($release.id) draft=$($release.draft))"
} else {
  $notesFile = Join-Path $env:TEMP "release-notes-$ver.md"
  if (Test-Path "docs/RELEASE_NOTES-v$ver.md") {
    Copy-Item "docs/RELEASE_NOTES-v$ver.md" $notesFile -Force
    Write-Output "using docs/RELEASE_NOTES-v$ver.md as the release body"
  } elseif (-not (Test-Path $notesFile)) {
    @"
## v$ver

See docs/OPTIMIZATION-PLAN.md for details.
"@ | Out-File $notesFile -Encoding UTF8
  }
  Write-Output "creating release $tag"
  $r = RunNative $gh @('release', 'create', $tag, '--title', $tag, '--latest', '--notes-file', $notesFile)
  if ($r.code -ne 0) {
    if ($r.out -match '403|not accessible') {
      Fail ("Creating the Release was denied (403): the token lacks repository write access.`n" +
            "  Fix it at GitHub -> Settings -> Developer settings -> Fine-grained tokens, edit this token:`n" +
            "    Repository access: include $repo`n" +
            "    Repository permissions -> Contents: Read and write`n" +
            "  Raw output: $($r.out)")
    }
    Fail "gh release create failed: $($r.out)"
  }
  Write-Output $r.out
}

# Re-read from the API: the Release must really exist and not be a draft.
$release = GetRelease $tag
if (-not $release) { Fail "release $tag still cannot be found after creation" }
if ($release.draft) { Fail "release $tag is still a draft" }
Write-Output "release ready: id=$($release.id) draft=$($release.draft) prerelease=$($release.prerelease)"

# ---------- 3) Recompute checksums from the current artifacts ----------
Write-Output "==> 3/6 checksums..."
$engineExe = "dist\disk-clean-win-x64.exe"
$setupExe = "gui\dist\disk-clean-setup-$ver.exe"
if (-not (Test-Path $engineExe)) { Fail "missing $engineExe (run scripts\build-sea.ps1 first)" }
if (-not (Test-Path $setupExe)) { Fail "missing $setupExe (run scripts\build-installer.ps1 first)" }
$engineSha = (Get-FileHash $engineExe -Algorithm SHA256).Hash.ToLower()
$setupSha = (Get-FileHash $setupExe -Algorithm SHA256).Hash.ToLower()
$enc = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText((Join-Path $root "dist\SHA256SUMS.txt"),
  "$engineSha  disk-clean-win-x64.exe`n$setupSha  disk-clean-setup-$ver.exe`n", $enc)
# Per-artifact .sha256 files are rewritten too, so they cannot disagree with the manifest.
[System.IO.File]::WriteAllText("$engineExe.sha256", "$engineSha  disk-clean-win-x64.exe`n", $enc)
[System.IO.File]::WriteAllText("$setupExe.sha256", "$setupSha  disk-clean-setup-$ver.exe`n", $enc)
Write-Output "engine sha256 = $engineSha"
Write-Output "setup  sha256 = $setupSha"

# ---------- 4) Upload assets ----------
Write-Output "==> 4/6 upload..."
$assets = @(
  $setupExe,
  "$setupExe.sha256",
  $engineExe,
  "$engineExe.sha256",
  "dist\SHA256SUMS.txt"
) | Where-Object { Test-Path $_ }

$r = RunNative $gh (@('release', 'upload', $tag) + $assets + @('--clobber'))
if ($r.code -ne 0) { Fail "gh release upload failed: $($r.out)" }
Write-Output "uploaded $($assets.Count) assets"

# Verify against the API: every asset present, sizes matching the local files.
$release = GetRelease $tag
if (-not $release) { Fail "release $tag disappeared during upload" }
$remoteNames = @($release.assets | ForEach-Object { $_.name })
foreach ($a in $assets) {
  $name = Split-Path $a -Leaf
  if ($remoteNames -notcontains $name) {
    Fail "asset missing on the remote release: $name (remote has: $($remoteNames -join ', '))"
  }
}
$remoteEngine = $release.assets | Where-Object { $_.name -eq 'disk-clean-win-x64.exe' }
$remoteSetup = $release.assets | Where-Object { $_.name -eq "disk-clean-setup-$ver.exe" }
if ($remoteEngine.size -ne (Get-Item $engineExe).Length) {
  Fail "remote engine size $($remoteEngine.size) != local $((Get-Item $engineExe).Length)"
}
if ($remoteSetup.size -ne (Get-Item $setupExe).Length) {
  Fail "remote setup size $($remoteSetup.size) != local $((Get-Item $setupExe).Length)"
}
Write-Output "assets verified ($($remoteNames.Count) items, sizes match)"

# ---------- 5) Download back and verify hashes ----------
Write-Output "==> 5/6 download-back verification..."
$pairs = @(
  @{ n = "disk-clean-setup-$ver.exe"; sha = $setupSha },
  @{ n = 'disk-clean-win-x64.exe'; sha = $engineSha }
)
foreach ($pair in $pairs) {
  $asset = $release.assets | Where-Object { $_.name -eq $pair.n }
  if (-not $asset) { Fail "remote is missing $($pair.n)" }
  $dl = Join-Path $env:TEMP ("dl-verify-" + $pair.n)
  try {
    Invoke-WebRequest $asset.browser_download_url -OutFile $dl -Headers @{ 'User-Agent' = 'dsh' } -TimeoutSec 900 -ErrorAction Stop
  } catch {
    Fail "download of $($pair.n) failed: $($_.Exception.Message)"
  }
  $dlSha = (Get-FileHash $dl -Algorithm SHA256).Hash.ToLower()
  Remove-Item $dl -Force -ErrorAction SilentlyContinue
  if ($dlSha -ne $pair.sha) { Fail "$($pair.n) hash mismatch: local $($pair.sha) vs downloaded $dlSha" }
  Write-Output "$($pair.n) hash OK"
}

# ---------- 6) Optional npm publish ----------
if ($PublishNpm) {
  Write-Output "==> 6/6 npm publish..."
  $pkgVer = (Get-Content (Join-Path $root "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json).version
  if ($pkgVer -ne $ver) { Fail "package.json version $pkgVer != $ver, aborting npm publish" }
  $r = RunNative 'npm' @('publish', '--access', 'public')
  Write-Output $r.out
  if ($r.code -ne 0) {
    if ($r.out -match 'OTP|one-time password|ENEEDAUTH|EOTP') {
      Write-Warning "npm publish needs an OTP/2FA code - please run 'npm publish' manually."
      Write-Output "GitHub Release finished; npm still needs a manual publish."
      exit 0
    }
    Fail "npm publish failed (the GitHub Release itself succeeded)"
  }
  Write-Output "npm publish OK"
} else {
  Write-Output "==> 6/6 npm skipped (no -PublishNpm)"
}

Write-Output ""
Write-Output "Publish verified: $tag"
Write-Output "  https://github.com/$repo/releases/tag/$tag"
