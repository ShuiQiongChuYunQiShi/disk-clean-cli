# push.ps1 - git push with proxy fallback and ls-remote verification
# Usage: powershell -File scripts/push.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

function TryPush($extraArgs) {
  $args = @('push','origin','master','--quiet') + $extraArgs
  $out = & git @args 2>&1 | Out-String
  # Suppress NativeCommandError for git's stderr in PS5.1 (exit code is the real signal)
  $code = $LASTEXITCODE
  if ($out.Trim()) { Write-Output $out }
  return $code -eq 0
}

# 1) Try with configured proxy (default)
Write-Output "Trying push with configured proxy..."
if (TryPush @()) {
  Write-Output "Push succeeded (proxy)"
} else {
  Write-Output "Proxy push failed, retrying direct..."
  if (TryPush @('-c','http.proxy=','-c','https.proxy=')) {
    Write-Output "Push succeeded (direct)"
  } else {
    Write-Error "Push failed both ways"
    exit 1
  }
}

# 2) Verify local == remote
$local = (git rev-parse HEAD).Trim()
$remote = ""
try { $remote = (git -c http.proxy= -c https.proxy= ls-remote origin master 2>$null).Split()[0].Trim() } catch {}
if (-not $remote) {
  try { $remote = (git ls-remote origin master 2>$null).Split()[0].Trim() } catch {}
}
Write-Output "local : $local"
Write-Output "remote: $remote"
if ($local -and $remote -and $local -eq $remote) {
  Write-Output "Verified: local == remote"
  exit 0
} else {
  Write-Warning "Verification failed (local != remote or remote empty)"
  exit 1
}
