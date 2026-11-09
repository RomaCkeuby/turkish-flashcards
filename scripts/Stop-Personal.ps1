$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
$privateDirectory = Join-Path $projectDirectory '.personal'
. (Join-Path $PSScriptRoot 'Personal-Common.ps1')
$lifecycleLock = Open-PersonalLock $privateDirectory
try {
  # An intentional stop remains stopped until personal:start is run manually.
  [IO.File]::WriteAllText((Join-Path $privateDirectory 'stopped'), [datetime]::UtcNow.ToString('o'))
  $stateFile = Join-Path $privateDirectory 'launch.json'
  if (!(Test-Path -LiteralPath $stateFile)) { Write-Output 'No saved launch found.'; return }
  $state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
  foreach ($serviceName in @('tunnel', 'server')) {
    $serviceProcess = Get-PersonalProcess $state $serviceName
    if ($serviceProcess) { Stop-Process -Id $serviceProcess.Id; $serviceProcess.WaitForExit(); Write-Output "Stopped $serviceName." }
  }
  Remove-Item -LiteralPath $stateFile
  $urlFile = Join-Path $privateDirectory 'server-url.txt'
  if (Test-Path -LiteralPath $urlFile) { Remove-Item -LiteralPath $urlFile }
} finally { $lifecycleLock.Dispose() }
