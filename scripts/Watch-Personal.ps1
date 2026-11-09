$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
$privateDirectory = Join-Path $projectDirectory '.personal'
New-Item -ItemType Directory -Force -Path $privateDirectory | Out-Null
$runtimeFile = Join-Path $privateDirectory 'runtime.json'
if (Test-Path -LiteralPath $runtimeFile) {
  $runtime = Get-Content -LiteralPath $runtimeFile -Raw | ConvertFrom-Json
  $env:PATH = (Split-Path -Parent $runtime.node) + ';' + $env:PATH
}
while ($true) {
  try { & (Join-Path $PSScriptRoot 'Start-Personal.ps1') -Monitor | Out-Null }
  catch {
    $logFile = Join-Path $privateDirectory 'watchdog.log'
    if ((Test-Path -LiteralPath $logFile) -and (Get-Item -LiteralPath $logFile).Length -gt 1MB) { Move-Item -LiteralPath $logFile -Destination ($logFile + '.previous') -Force }
    Add-Content -LiteralPath $logFile -Value ("{0:o} {1}" -f [datetime]::UtcNow, $_.Exception.Message)
  }
  Start-Sleep -Seconds 30
}
