param([switch]$Uninstall)
$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$taskName = 'TurkishFlashcards-Personal'
if ($Uninstall) {
  $existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($existingTask) { Stop-ScheduledTask -TaskName $taskName; Unregister-ScheduledTask -TaskName $taskName -Confirm:$false }
  Write-Output 'Autostart removed. Running server and tunnel are unchanged.'
  return
}
$privateDirectory = Join-Path $projectDirectory '.personal'
New-Item -ItemType Directory -Force -Path $privateDirectory | Out-Null
[IO.File]::WriteAllText((Join-Path $privateDirectory 'runtime.json'), (@{ node = (Get-Command node -ErrorAction Stop).Source } | ConvertTo-Json))
$watchFile = Join-Path $PSScriptRoot 'Watch-Personal.ps1'
$powerShell = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
$action = New-ScheduledTaskAction -Execute $powerShell -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $watchFile + '"') -WorkingDirectory $projectDirectory
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([timespan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Start personal flashcards at sign-in; recover server and tunnel every 30 seconds.' -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Output "Autostart enabled: $taskName (current Windows user only)."
