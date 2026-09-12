# publish-release.ps1 - One-command GitHub Release publish
# Usage: powershell -File scripts\publish-release.ps1 <ver> [-PublishNpm]
#   e.g. powershell -File scripts\publish-release.ps1 0.5.0 -PublishNpm
# Requires: $env:GH_TOKEN (fine-grained PAT with **Contents: Read and write**),
#           gh at C:\Program Files\GitHub CLI\gh.exe or in PATH
#
# HUMAN APPROVAL IS REQUIRED (S4). This script exits 1 unless a human first ran
#   node scripts\approval.js confirm --version <ver> --by "<name>"
# The approval seals the sha256 of every artifact, so rebuilding after approval
# invalidates it. There is deliberately no --yes / --force / --skip-approval:
# an approval gate with a bypass is not a gate. See scripts\approval.js for what
# this can and cannot defend against (it is a procedural gate, not a sandbox).
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

# Fail writes to stderr directly instead of using Write-Error. PowerShell 5.1 turns
# Write-Error into a "CategoryInfo / FullyQualifiedErrorId" block that buries the actual
# reason under script source lines. The refusal message IS the user interface of this
# script - when a release is blocked, that sentence is the only thing the human needs to
# read, so it has to come out intact. Defined here so the early argument checks can use it.
function Fail($msg) { [Console]::Error.WriteLine($msg); exit 1 }

if (-not $ver) { Fail "Usage: publish-release.ps1 <ver>  e.g. 0.5.0" }
if ($ver -notmatch '^\d+\.\d+\.\d+$') { Fail "Version must be x.y.z" }

$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
$gh = "C:\Program Files\GitHub CLI\gh.exe"
if (-not (Test-Path $gh)) { $gh = "gh" }

$tag = "v$ver"

# Release identity and the artifact list come from the manifest (S3), not from
# literals repeated across scripts and docs. The old literals drifted: the repo
# name, asset names and the checksums format each lived in several places.
$manifestPath = Join-Path $root "disk-clean.config.json"
if (-not (Test-Path $manifestPath)) { Fail "missing disk-clean.config.json" }
$manifest = Get-Content $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$repo = $manifest.repo
# NOTE: $apiHeaders is built later, right after the credential block. Building it here
# would capture an empty GH_TOKEN whenever the value comes from the credentials file.

# The manifest declares names and paths with a ${version} placeholder, and BOTH must be
# expanded. v0.7.1 shipped a defect where only the path was: the asset-name lookup then
# compared "disk-clean-setup-${version}.exe" against the real name, failed to find the
# installer, and - worse - wrote that literal placeholder into the published
# checksums.txt and SHA256SUMS.txt. The only symptom was a confusing
# "remote setup size != local", which is why this is now gated by a static assertion
# in test/approval-gate.js.
function Expand-Version([string]$s) { return ($s -replace '\$\{version\}', $ver) }
function ManifestPath($asset) { return (Expand-Version $asset.path) }
function ManifestName($asset) { return (Expand-Version $asset.name) }
$engineAsset = $manifest.release.assets | Where-Object { $_.role -eq 'engine' } | Select-Object -First 1
$setupAsset = $manifest.release.assets | Where-Object { $_.role -eq 'installer' } | Select-Object -First 1
if (-not $engineAsset) { Fail "disk-clean.config.json declares no asset with role=engine" }
if (-not $setupAsset) { Fail "disk-clean.config.json declares no asset with role=installer" }

# Wrapper for native commands: returns @{ code; out } and never throws on stderr noise.
# The SilentlyContinue scope matters for readability: PowerShell 5.1 turns a native
# command's stderr into an ErrorRecord and prints a CategoryInfo block, which used to
# bury the actual reason a release was refused ("no approval file") under a wall of
# "At ... char:10 + $out = & $file @argList". The exit code is still captured and every
# caller checks it, so nothing is swallowed.
function RunNative($file, $argList) {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'SilentlyContinue'
  try {
    $out = & $file @argList 2>&1 | Out-String
    return @{ code = $LASTEXITCODE; out = $out }
  } finally {
    $ErrorActionPreference = $prev
  }
}

function GetRelease($tagName) {
  try {
    return Invoke-RestMethod "https://api.github.com/repos/$repo/releases/tags/$tagName" -Headers $apiHeaders -TimeoutSec 30 -ErrorAction Stop
  } catch {
    return $null
  }
}

# ---------- 0) Release approval gate (S4) ----------
# Nothing else in this script may run first: no tag, no release, no upload.
# This is the only step whose failure means "a human has not agreed to this".
Write-Output "==> 0/7 release approval gate..."
$gate = RunNative 'node' @('scripts\approval.js', 'check', '--version', $ver)
Write-Output $gate.out.Trim()
if ($gate.code -ne 0) {
  Fail ("Release blocked: no valid human approval for v$ver.`n" +
        "  A human runs: node scripts\approval.js confirm --version $ver --by `"<name>`"`n" +
        "  There is no --yes / --force for this gate, by design.")
}

# ---------- 0b) Release prerequisites: curated notes + a run guide ----------
# These two files used to be "documented conventions" that nothing enforced, which is
# why releases could ship with no written record of what changed or how to verify it.
# A convention with no script behind it is not a rule (see docs/SOP-UPGRADE-PLAN.md 1.8).
foreach ($doc in @("docs\RELEASE_NOTES-v$ver.md", "docs\release-guide-v$ver.md")) {
  if (-not (Test-Path (Join-Path $root $doc))) {
    Fail ("missing $doc`n" +
          "  A release needs curated notes and a per-release guide before it ships.`n" +
          "  Generate the guide skeleton: node scripts/dev.js release-guide --version $ver")
  }
}
Write-Output "release prerequisites present (notes + guide)"

# Credentials: process env first, then ~/.disk-clean/credentials.json.
# This block deliberately sits AFTER the approval gate: "should this be released"
# comes before "is the toolchain able to release it". Reversed, a missing token
# reports as a credential problem and nobody learns the real blocker.
# The file fallback is not a convenience, it is required. Windows user-scope
# environment variables are snapshotted when a process starts, so setting one does
# not reach an already-running session or anything it spawns. Verified: right after
# [Environment]::SetEnvironmentVariable(...,'User'), a child of the running session
# still sees an empty $env:GH_TOKEN - which is how "I already set it" turns into a
# repeating false alarm.
function Resolve-Credential([string]$name) {
  $v = [Environment]::GetEnvironmentVariable($name, 'Process')
  if ($v) { return $v }
  $cf = Join-Path $HOME '.disk-clean\credentials.json'
  if (Test-Path $cf) {
    try {
      $j = Get-Content $cf -Raw -Encoding UTF8 | ConvertFrom-Json
      $p = $j.$name
      if ($p) { return [string]$p }
    } catch { return $null }
  }
  return $null
}

if (-not $env:GH_TOKEN) { $env:GH_TOKEN = Resolve-Credential 'GH_TOKEN' }
if (-not $env:GH_TOKEN) {
  Fail ("GH_TOKEN is not available.`n" +
        "  node scripts/dev.js credentials import   (import User-scope env vars into ~/.disk-clean/credentials.json)`n" +
        "  or set GH_TOKEN in this shell.")
}
# ~/.npmrc references ${NPM_TOKEN}, so the value must be in this process's environment
# for the npm publish step to authenticate. Injected here rather than exported globally:
# npm reads the file, and this keeps the secret out of a machine-wide variable.
if (-not $env:NPM_TOKEN) { $env:NPM_TOKEN = Resolve-Credential 'NPM_TOKEN' }

# Built only now, so it always carries a real token regardless of which source it came from
$apiHeaders = @{ Authorization = "Bearer $env:GH_TOKEN"; "User-Agent" = "dsh"; Accept = "application/vnd.github+json" }

# ---------- 1) Preflight: repo reachable with this token ----------
Write-Output "==> 1/7 preflight..."
try {
  $null = Invoke-RestMethod "https://api.github.com/repos/$repo" -Headers $apiHeaders -TimeoutSec 30 -ErrorAction Stop
} catch {
  Fail "Cannot read repo $repo with this token: $($_.Exception.Message)"
}
Write-Output "token can read $repo"

# ---------- 2) Ensure the tag exists and is pushed ----------
Write-Output "==> 2/7 tag $tag ..."
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

# ---------- 3) Create the Release (non-draft); skip when it already exists ----------
Write-Output "==> 3/7 release..."
$release = GetRelease $tag
$notesFile = Join-Path $env:TEMP "release-notes-$ver.md"
$haveNotes = $false
if (Test-Path "docs/RELEASE_NOTES-v$ver.md") {
  Copy-Item "docs/RELEASE_NOTES-v$ver.md" $notesFile -Force
  $haveNotes = $true
  Write-Output "using docs/RELEASE_NOTES-v$ver.md as the release body"
} elseif (Test-Path $notesFile) {
  $haveNotes = $true
}

if ($release) {
  Write-Output "release $tag already exists (id=$($release.id) draft=$($release.draft))"
  # CI creates a release on tag pushes with GitHub's auto-generated notes.
  # If we have a curated body, overwrite it so the published text is ours.
  if ($haveNotes) {
    $r = RunNative $gh @('release', 'edit', $tag, '--notes-file', $notesFile)
    if ($r.code -ne 0) { Fail "gh release edit (body) failed: $($r.out)" }
    Write-Output "release body synced from the curated notes file"
  }
} else {
  if (-not $haveNotes) {
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

# ---------- 4) Artifact fingerprint + checksums ----------
Write-Output "==> 4/7 artifact fingerprint + checksums..."
$engineExe = ManifestPath $engineAsset
$setupExe = ManifestPath $setupAsset
if (-not (Test-Path $engineExe)) { Fail "missing $engineExe (run $($engineAsset.producer) first)" }
if (-not (Test-Path $setupExe)) { Fail "missing $setupExe (run $($setupAsset.producer) first)" }

# S9: the exe must prove it was built from the current commit on a clean tree.
# A stale binary (built before the last edit) is otherwise indistinguishable from
# a correct one: same version, self-consistent checksums, download-verify passes.
$fpArgs = @('scripts\fingerprint.js', 'check', '--exe', $engineExe, '--json')
$fpRes = RunNative 'node' $fpArgs
$fpJson = $null
try { $fpJson = $fpRes.out | ConvertFrom-Json } catch { $fpJson = $null }
if ($fpRes.code -ne 0 -or -not $fpJson -or -not $fpJson.ok) {
  $detail = if ($fpJson -and $fpJson.checks) {
    ($fpJson.checks | Where-Object { -not $_.ok } | ForEach-Object { "`n    - " + $_.name + ": " + $_.detail }) -join ''
  } else { "`n    " + $fpRes.out.Trim() }
  Fail ("Artifact does not match the source tree (S9).$detail`n" +
        "  Fix: commit the source, then rebuild (scripts\build-sea.ps1) and re-approve.")
}
Write-Output ("fingerprint OK: v$($fpJson.info.version) commit=$($fpJson.info.commit) dirty=$($fpJson.info.dirty)")

$engineSha = (Get-FileHash $engineExe -Algorithm SHA256).Hash.ToLower()
$setupSha = (Get-FileHash $setupExe -Algorithm SHA256).Hash.ToLower()
$buildCommit = $fpJson.info.commit
$engineName = ManifestName $engineAsset
$setupName = ManifestName $setupAsset
$sumsAsset = $manifest.release.assets | Where-Object { $_.name -eq 'SHA256SUMS.txt' } | Select-Object -First 1
$ckAsset = $manifest.release.assets | Where-Object { $_.name -eq 'checksums.txt' } | Select-Object -First 1
if (-not $sumsAsset -or -not $ckAsset) { Fail "disk-clean.config.json must declare SHA256SUMS.txt and checksums.txt" }
$sumsFile = ManifestPath $sumsAsset
$ckFile = ManifestPath $ckAsset

# Every checksum file is regenerated here from the artifacts that are about to be
# uploaded, so none of them can describe a build that is no longer there (issue G53:
# v0.5.0 shipped sha256=72ce9f21... for an exe hashing 3cbdc188...). CI also publishes
# its own checksums.txt on tag push, built from CI's own SEA run -- this rewrite
# replaces it. Each line carries the build commit as well, so a checksum file on its
# own still says which source revision the artifact came from.
$enc = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($sumsFile, "$engineSha  $engineName`n$setupSha  $setupName`n", $enc)
[System.IO.File]::WriteAllText("$engineExe.sha256", "$engineSha  $engineName`n", $enc)
[System.IO.File]::WriteAllText("$setupExe.sha256", "$setupSha  $setupName`n", $enc)
[System.IO.File]::WriteAllText($ckFile,
  "$engineName  sha256=$engineSha  size=$((Get-Item $engineExe).Length)  version=$ver  commit=$buildCommit`n" +
  "$setupName  sha256=$setupSha  size=$((Get-Item $setupExe).Length)  version=$ver  commit=$buildCommit`n", $enc)
Write-Output "engine sha256 = $engineSha"
Write-Output "setup  sha256 = $setupSha"
Write-Output "build  commit = $buildCommit"

# ---------- 5) Upload assets ----------
Write-Output "==> 5/7 upload..."

# Re-check the approval immediately before the irreversible step. The artifact hashes
# are recomputed here, so an artifact swapped during this run is caught as well.
$gate2 = RunNative 'node' @('scripts\approval.js', 'check', '--version', $ver)
if ($gate2.code -ne 0) {
  Write-Output $gate2.out.Trim()
  Fail "Release blocked: approval no longer valid at upload time (artifacts changed after approval?)"
}

$assets = @()
foreach ($a in $manifest.release.assets) {
  $p = ManifestPath $a
  if (Test-Path $p) { $assets += $p }
}
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
$remoteEngine = $release.assets | Where-Object { $_.name -eq $engineName }
$remoteSetup = $release.assets | Where-Object { $_.name -eq $setupName }
if ($remoteEngine.size -ne (Get-Item $engineExe).Length) {
  Fail "remote engine size $($remoteEngine.size) != local $((Get-Item $engineExe).Length)"
}
if ($remoteSetup.size -ne (Get-Item $setupExe).Length) {
  Fail "remote setup size $($remoteSetup.size) != local $((Get-Item $setupExe).Length)"
}
# checksums.txt must actually describe the artifacts that are on the release. A size check
# is not enough here: the file is small and a stale copy has the right size but the wrong hash.
$remoteChecksums = $release.assets | Where-Object { $_.name -eq 'checksums.txt' }
if (-not $remoteChecksums) { Fail "checksums.txt is missing on the remote release" }
$ckText = (Invoke-WebRequest $remoteChecksums.browser_download_url -Headers @{ 'User-Agent' = 'dsh' } -TimeoutSec 60 -UseBasicParsing).Content
# PowerShell 5.1 hands back a Byte[] from -UseBasicParsing whenever the response has no
# text-ish content type (this script runs under `powershell -File`, i.e. 5.1). Comparing
# a Byte[] with -match always fails, which would make this check report a bogus mismatch
# on a perfectly good release (verified against the real v0.5.0 asset). Decode explicitly.
if ($ckText -is [byte[]]) { $ckText = [System.Text.Encoding]::UTF8.GetString($ckText) }
$ckText = [string]$ckText
if ($ckText -notmatch [regex]::Escape($engineSha)) {
  Fail ("remote checksums.txt does not mention the published engine hash`n" +
        "  expected: $engineSha`n" +
        "  remote  : $($ckText.Trim())`n" +
        "  Fix: re-run this script (step 3 rewrites dist\checksums.txt and step 4 re-uploads it).")
}
Write-Output "checksums.txt matches the published engine hash"
Write-Output "assets verified ($($remoteNames.Count) items, sizes match)"

# ---------- 6) Download back and verify hashes ----------
Write-Output "==> 6/7 download-back verification..."
$pairs = @(
  @{ n = $setupName; sha = $setupSha },
  @{ n = $engineName; sha = $engineSha }
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

# ---------- 7) Optional npm publish ----------
if ($PublishNpm) {
  Write-Output "==> 7/7 npm publish..."
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
  Write-Output "==> 7/7 npm skipped (no -PublishNpm)"
}

Write-Output ""
Write-Output "Publish verified: $tag"
Write-Output "  https://github.com/$repo/releases/tag/$tag"
