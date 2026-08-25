# push.ps1 - git push with proxy fallback and ls-remote/API verification
# Usage: powershell -File scripts/push.ps1
$ErrorActionPreference = 'Continue'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

function TryPush($extraArgs) {
  # G50: 2>&1 merge makes PS5.1 turn git stderr into ErrorRecords and can
  # corrupt exit-code judgement; redirect stderr to a temp file instead.
  $oldEAP = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  $errFile = [IO.Path]::GetTempFileName()
  $gitArgs = @('push', 'origin', 'master', '--quiet') + $extraArgs
  & git @gitArgs 2> $errFile | Out-Null
  $code = $LASTEXITCODE
  $ErrorActionPreference = $oldEAP
  $errText = ''
  try { $errText = (Get-Content $errFile -Raw -ErrorAction SilentlyContinue) } catch {}
  Remove-Item $errFile -Force -ErrorAction SilentlyContinue
  if ($code -ne 0 -and $errText) { Write-Output ("push stderr: " + $errText.Trim()) }
  return $code -eq 0
}

# 1) Proxy first (configured), fallback direct
Write-Output "Trying push with configured proxy..."
if (TryPush @()) {
  Write-Output "Push succeeded (proxy)"
} else {
  Write-Output "Proxy push failed, retrying direct..."
  if (TryPush @('-c', 'http.proxy=', '-c', 'https.proxy=')) {
    Write-Output "Push succeeded (direct)"
  } else {
    Write-Output "Push failed both ways"
    exit 1
  }
}

# 2) Verify local == remote (ls-remote both channels; GH_TOKEN API as last resort)
$local = (git rev-parse HEAD).Trim()
$remote = ''
foreach ($chan in @(@('-c','http.proxy=','-c','https.proxy='), @())) {
  try {
    $line = (& git @chan ls-remote origin master 2>$null) | Select-Object -First 1
    if ($line) { $remote = ($line.Split())[0].Trim(); break }
  } catch {}
}
if (-not $remote -and $env:GH_TOKEN) {
  try {
    $h = @{ Authorization = "Bearer $env:GH_TOKEN"; "User-Agent" = "dsh" }
    $b = Invoke-RestMethod "https://api.github.com/repos/ShuiQiongChuYunQiShi/disk-clean-cli/branches/master" -Headers $h -TimeoutSec 20
    $remote = $b.commit.sha
  } catch {}
}
Write-Output "local : $local"
Write-Output "remote: $remote"
if ($local -and $remote -and $local -eq $remote) {
  Write-Output "Verified: local == remote"
  exit 0
}
Write-Warning "Verification failed (local != remote or remote unreachable)"
exit 1
