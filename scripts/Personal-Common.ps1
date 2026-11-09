function Get-PersonalProcess($State, [string]$Name) {
  if (!$State -or !$State.($Name + 'ProcessId')) { return $null }
  $candidate = Get-Process -Id $State.($Name + 'ProcessId') -ErrorAction SilentlyContinue
  $expectedName = if ($Name -eq 'server') { 'node' } else { 'cloudflared' }
  if ($candidate -and $candidate.ProcessName -eq $expectedName -and $candidate.StartTime.ToUniversalTime().Ticks -eq ([datetime]$State.($Name + 'StartedAt')).ToUniversalTime().Ticks) { return $candidate }
  return $null
}
function Save-PersonalState($State, [string]$Path) {
  [IO.File]::WriteAllText(($Path + '.tmp'), ($State | ConvertTo-Json))
  Move-Item -LiteralPath ($Path + '.tmp') -Destination $Path -Force
}
function Open-PersonalLock([string]$Directory) {
  New-Item -ItemType Directory -Force -Path $Directory | Out-Null
  for ($lockAttempt = 0; $lockAttempt -lt 120; $lockAttempt++) {
    try { return [IO.File]::Open((Join-Path $Directory 'lifecycle.lock'), 'OpenOrCreate', 'ReadWrite', 'None') }
    catch [IO.IOException] { Start-Sleep -Milliseconds 500 }
  }
  throw 'Another personal-server operation is still running.'
}
