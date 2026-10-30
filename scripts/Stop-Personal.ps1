$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
$stateFile = Join-Path $projectDirectory '.personal/launch.json'
if (!(Test-Path -LiteralPath $stateFile)) { Write-Output 'No saved launch found.'; return }
$state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
# Check creation time as well as PID so a reused PID cannot stop an unrelated app.
foreach ($serviceName in @('tunnel', 'server')) {
  $processId = $state.($serviceName + 'ProcessId')
  $startedAt = $state.($serviceName + 'StartedAt')
  $serviceProcess = Get-Process -Id $processId -ErrorAction SilentlyContinue
  if ($serviceProcess -and $serviceProcess.StartTime.ToUniversalTime().ToString('o') -eq $startedAt) {
    Stop-Process -Id $processId
    Write-Output "Stopped $serviceName."
  }
}
# This file contains only our launch PIDs and temporary URL; credentials and progress are kept.
Remove-Item -LiteralPath $stateFile
