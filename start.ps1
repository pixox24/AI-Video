$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$Host.UI.RawUI.WindowTitle = 'AI-Video'
$appUrl = 'http://localhost:3000'
$healthUrl = 'http://127.0.0.1:3000/api/health'

function Test-ServerUp {
  try {
    $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
  } catch {
    return $false
  }
}

Write-Host ''
Write-Host '  AI-Video'
Write-Host "  $appUrl"
Write-Host ''

$bun = Get-Command bun -ErrorAction SilentlyContinue
if (-not $bun) {
  Write-Host 'bun not found. Install: https://bun.sh'
  Pause
  exit 1
}

if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules'))) {
  Write-Host 'Installing dependencies...'
  bun install
  if ($LASTEXITCODE -ne 0) {
    Write-Host 'bun install failed.'
    Pause
    exit 1
  }
}

if (Test-ServerUp) {
  Write-Host 'Server already running. Opening browser.'
  Start-Process $appUrl
  Write-Host 'You can close this window without stopping the existing server.'
  Pause
  exit 0
}

$opener = Start-Job -ScriptBlock {
  param($Health, $OpenUrl)
  for ($i = 0; $i -lt 45; $i++) {
    Start-Sleep -Seconds 1
    try {
      $null = Invoke-WebRequest -Uri $Health -UseBasicParsing -TimeoutSec 1
      Start-Process $OpenUrl
      return
    } catch {
    }
  }
} -ArgumentList $healthUrl, $appUrl

Write-Host 'Starting local server. Browser opens when ready.'
Write-Host 'Ctrl+C or close this window to stop the server.'
Write-Host ''

try {
  bun run dev
} finally {
  Stop-Job $opener -ErrorAction SilentlyContinue
  Remove-Job $opener -Force -ErrorAction SilentlyContinue
}
