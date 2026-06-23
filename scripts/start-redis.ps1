# Starts the portable Redis (installed to %LOCALAPPDATA%\Redis) if not already running.
# Usage:  pwsh -File scripts/start-redis.ps1   (or run from PowerShell)
$dest = "$env:LOCALAPPDATA\Redis"
$exe = Join-Path $dest "redis-server.exe"

if (-not (Test-Path $exe)) {
  Write-Error "Redis not found at $exe. Re-download the portable build or install Memurai/WSL Redis."
  exit 1
}

if (Get-Process redis-server -ErrorAction SilentlyContinue) {
  Write-Output "redis-server already running."
} else {
  Start-Process -FilePath $exe -ArgumentList (Join-Path $dest "redis.windows.conf") -WindowStyle Hidden
  Start-Sleep -Seconds 2
  Write-Output "redis-server started."
}

& (Join-Path $dest "redis-cli.exe") ping
