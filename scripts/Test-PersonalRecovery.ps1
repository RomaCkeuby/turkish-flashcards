# Integration test: briefly interrupts the running personal site and changes its
# temporary tunnel URL. Requires the autostart task to be installed and running.
$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
$stateFile = Join-Path $projectDirectory '.personal/launch.json'
. (Join-Path $PSScriptRoot 'Personal-Common.ps1')
function Read-TestState { Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json }
function Wait-Recovered([string]$Name, [int]$PreviousId) {
  for ($check = 0; $check -lt 90; $check++) {
    Start-Sleep -Seconds 1
    if (Test-Path -LiteralPath $stateFile) {
      $current = Read-TestState
      if ($current.($Name + 'ProcessId') -ne $PreviousId -and (Get-PersonalProcess $current $Name) -and $current.url) {
        if ((Invoke-RestMethod -Uri 'http://127.0.0.1:3002/healthz' -TimeoutSec 3) -eq 'ok') { return $current }
      }
    }
  }
  throw "Watchdog did not recover $Name within 90 seconds."
}
$task = Get-ScheduledTask -TaskName 'TurkishFlashcards-Personal'
if ($task.State -ne 'Running') { throw 'Autostart watchdog is not running.' }
$before = Read-TestState
$server = Get-PersonalProcess $before 'server'
if (!$server) { throw 'No tracked running server.' }
# The same PID with an incorrect birth time must never match.
$wrongState = @{ serverProcessId = $server.Id; serverStartedAt = '2000-01-01T00:00:00Z' }
if (Get-PersonalProcess $wrongState 'server') { throw 'Process identity guard failed.' }
Stop-Process -Id $server.Id
$after = Wait-Recovered 'server' $server.Id
if ($after.tunnelProcessId -ne $before.tunnelProcessId -or $after.url -ne $before.url) { throw 'Server recovery replaced the healthy tunnel.' }
Write-Output 'PASS: crashed server recovered; tunnel and URL preserved; PID identity guard works.'
$tunnel = Get-PersonalProcess $after 'tunnel'
if (!$tunnel) { throw 'No tracked running tunnel.' }
Stop-Process -Id $tunnel.Id
$recovered = Wait-Recovered 'tunnel' $tunnel.Id
if ($recovered.serverProcessId -ne $after.serverProcessId) { throw 'Tunnel recovery replaced the healthy server.' }
Write-Output 'PASS: crashed tunnel recovered; healthy server preserved.'
try {
  & (Join-Path $PSScriptRoot 'Stop-Personal.ps1') | Out-Null
  Start-Sleep -Seconds 35
  if (Test-Path -LiteralPath $stateFile) { throw 'Watchdog ignored intentional stop.' }
  Write-Output 'PASS: intentional stop respected by watchdog.'
} finally { & (Join-Path $PSScriptRoot 'Start-Personal.ps1') }
$resumed = Read-TestState
& (Join-Path $PSScriptRoot 'Start-Personal.ps1') -Monitor | Out-Null
$idempotent = Read-TestState
if ($idempotent.serverProcessId -ne $resumed.serverProcessId -or $idempotent.tunnelProcessId -ne $resumed.tunnelProcessId) { throw 'Healthy processes were restarted.' }
Write-Output 'PASS: manual resume and repeated healthy start work.'
