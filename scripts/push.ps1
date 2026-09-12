# push.ps1 - git push with proxy fallback and ls-remote/API verification
# Usage: powershell -File scripts/push.ps1
#
# G50: 2>&1 merge makes PS5.1 turn git stderr into ErrorRecords and can
# corrupt exit-code judgement; redirect stderr to a temp file instead.
#
# G55 (2026-09-11): the proxy push reported "Push succeeded" while the remote
# still pointed at the previous commit, so the direct fallback below never ran
# - the push silently did not happen and only the step-2 verification noticed.
# Two causes, both fixed here:
#   1) $LASTEXITCODE was not cleared before invoking git. If the git process
#      fails to launch at all, PowerShell leaves the PREVIOUS value in place
#      (often 0) and the failure reads as success. It is now set to $null first
#      and a null afterwards is treated as failure.
#   2) Success was declared from git's exit code alone. A proxy attempt must now
#      survive the local-vs-remote check before it counts, so a "reported success
#      but nothing moved" outcome falls through to the direct try.
$ErrorActionPreference = 'Continue'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

function ReadRemoteHead() {
  # Read through whichever channel works: direct first, then configured proxy,
  # then the GitHub API. Returns '' when the remote cannot be reached at all.
  foreach ($chan in @(@('-c', 'http.proxy=', '-c', 'https.proxy='), @())) {
    try {
      $line = (& git @chan ls-remote origin master 2>$null) | Select-Object -First 1
      if ($line) { return ($line.Split())[0].Trim() }
    } catch { }
  }
  if ($env:GH_TOKEN) {
    try {
      $h = @{ Authorization = "Bearer $env:GH_TOKEN"; "User-Agent" = "dsh" }
      $b = Invoke-RestMethod "https://api.github.com/repos/ShuiQiongChuYunQiShi/disk-clean-cli/branches/master" -Headers $h -TimeoutSec 20
      return $b.commit.sha
    } catch { }
  }
  return ''
}

function TryPush($extraArgs) {
  $oldEAP = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  $errFile = [IO.Path]::GetTempFileName()
  $gitArgs = @('push', 'origin', 'master', '--quiet') + $extraArgs
  $global:LASTEXITCODE = $null          # see G55 #1 above
  $launched = $true
  try {
    & git @gitArgs 2> $errFile | Out-Null
  } catch {
    $launched = $false                  # the process never started
  }
  $code = $LASTEXITCODE
  $ErrorActionPreference = $oldEAP
  $errText = ''
  try { $errText = (Get-Content $errFile -Raw -ErrorAction SilentlyContinue) } catch { }
  Remove-Item $errFile -Force -ErrorAction SilentlyContinue
  if ($errText) { Write-Output ("push stderr: " + $errText.Trim()) }
  if (-not $launched) { Write-Output 'push could not start git at all'; return $false }
  if ($null -eq $code) { Write-Output 'push left no exit code (treated as failure)'; return $false }
  return $code -eq 0
}

$local = (& git rev-parse HEAD).Trim()

# 1) Proxy first (configured), fallback direct.
#    Neither attempt counts as success until the remote actually agrees.
Write-Output "Trying push with configured proxy..."
$pushed = TryPush @()
$remote = ''
if ($pushed) {
  $remote = ReadRemoteHead
  if ($remote -and $remote -eq $local) {
    Write-Output "Push succeeded (proxy)"
  } else {
    Write-Output ("proxy push reported success but the remote shows '" + $remote + "' - retrying direct...")
    $pushed = $false
  }
}
if (-not $pushed) {
  Write-Output "Trying push direct (no proxy)..."
  if (TryPush @('-c', 'http.proxy=', '-c', 'https.proxy=')) {
    $remote = ReadRemoteHead
    if ($remote -and $remote -eq $local) { Write-Output "Push succeeded (direct)" }
    else { Write-Output ("direct push reported success but the remote shows '" + $remote + "'") }
  } else {
    Write-Output "Push failed both ways"
  }
}

# 2) Verify local == remote (ls-remote both channels; GH_TOKEN API as last resort)
if (-not $remote) { $remote = ReadRemoteHead }
Write-Output "local : $local"
Write-Output "remote: $remote"
if ($local -and $remote -and $local -eq $remote) {
  Write-Output "Verified: local == remote"
  exit 0
}
Write-Warning "Verification failed (local != remote or remote unreachable)"
Write-Warning "If the proxy on 127.0.0.1:7890 is down, start it, or push direct with:"
Write-Warning "  git -c http.proxy= -c https.proxy= push origin master"
exit 1
