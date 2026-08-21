# publish-release.ps1 - One-command GitHub Release publish
# Usage: powershell -File scripts/publish-release.ps1 <ver>
#   e.g. powershell -File scripts/publish-release.ps1 0.4.0
# Requires: $env:GH_TOKEN (fine-grained PAT), gh at C:\Program Files\GitHub CLI\gh.exe or in PATH
param([string]$ver)
$ErrorActionPreference = 'Continue'
if (-not $ver) { Write-Error "Usage: publish-release.ps1 <ver>  e.g. 0.4.0"; exit 1 }
if ($ver -notmatch '^\d+\.\d+\.\d+$') { Write-Error "Version must be x.y.z"; exit 1 }

$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
$gh = "C:\Program Files\GitHub CLI\gh.exe"
if (-not (Test-Path $gh)) { $gh = "gh" }
if (-not $env:GH_TOKEN) { Write-Error "GH_TOKEN not set"; exit 1 }

# 1) Ensure tag exists and pushed
$tag = "v$ver"
$hasTag = ((git tag -l $tag) | Out-String).Trim()
if (-not $hasTag) {
  Write-Output "Creating tag $tag..."
  $oldEAP = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  git tag $tag 2>&1 | Out-String | Write-Output
  git push origin $tag 2>&1 | Out-String | Write-Output
  $ErrorActionPreference = $oldEAP
  if ($LASTEXITCODE -ne 0) { Write-Error "git push tag failed"; exit 1 }
}

# 2) Create Release (non-draft) if not exists
$exists = & $gh release view $tag --json tagName 2>$null | Out-String
if ($LASTEXITCODE -ne 0) {
  $notesFile = "C:\temp\release-notes-$ver.md"
  $notes = @"
## v$ver

See docs/OPTIMIZATION-PLAN.md for details.
"@
  $notes | Out-File $notesFile -Encoding UTF8
  Write-Output "Creating release $tag..."
  & $gh release create $tag --title $tag --latest --notes-file $notesFile 2>&1 | Out-String | Write-Output
} else {
  Write-Output "Release $tag already exists"
}

# 3) Ensure SHA256SUMS.txt is up to date
$engineSha = (Get-FileHash "dist\disk-clean-win-x64.exe" -Algorithm SHA256 -ErrorAction SilentlyContinue).Hash.ToLower()
$setupSha = (Get-FileHash "gui\dist\disk-clean-setup-$ver.exe" -Algorithm SHA256 -ErrorAction SilentlyContinue).Hash.ToLower()
if ($engineSha -and $setupSha) {
  [System.IO.File]::WriteAllText((Join-Path $root "dist\SHA256SUMS.txt"), "$engineSha  disk-clean-win-x64.exe`n$setupSha  disk-clean-setup-$ver.exe`n", (New-Object System.Text.UTF8Encoding($false)))
  Write-Output "SHA256SUMS.txt regenerated"
}

# 4) Upload assets (background would timeout, so run synchronously with --clobber)
$assets = @(
  "gui\dist\disk-clean-setup-$ver.exe",
  "gui\dist\disk-clean-setup-$ver.exe.sha256",
  "dist\disk-clean-win-x64.exe",
  "dist\disk-clean-win-x64.exe.sha256",
  "dist\SHA256SUMS.txt"
) | Where-Object { Test-Path $_ }

Write-Output "Uploading $($assets.Count) assets..."
& $gh release upload $tag $assets --clobber 2>&1 | Out-String | Write-Output
Write-Output "Upload done"

# 5) Verify draft=false
$apiHeaders = @{ Authorization = "Bearer $env:GH_TOKEN"; "User-Agent" = "dsh" }
$r = Invoke-RestMethod "https://api.github.com/repos/ShuiQiongChuYunQiShi/disk-clean-cli/releases/tags/$tag" -Headers $apiHeaders
Write-Output ("Release: draft=" + $r.draft + " prerelease=" + $r.prerelease)
if ($r.draft) { Write-Error "Release is still draft!"; exit 1 }

# 6) Download and verify setup SHA
$dl = "C:\temp\dl-verify-$ver.exe"
$setupUrl = ($r.assets | Where-Object { $_.name -eq "disk-clean-setup-$ver.exe" }).browser_download_url
if ($setupUrl) {
  Invoke-WebRequest $setupUrl -OutFile $dl -Headers @{"User-Agent"="dsh"}
  $dlSha = (Get-FileHash $dl -Algorithm SHA256).Hash.ToLower()
  Write-Output ("Local setup SHA:  " + $setupSha)
  Write-Output ("Downloaded SHA:   " + $dlSha)
  if ($dlSha -ne $setupSha) { Write-Error "SHA mismatch!"; exit 1 }
  Write-Output "SHA verified: MATCH"
  Remove-Item $dl -Force -ErrorAction SilentlyContinue
}

Write-Output "Publish verified: $tag"
