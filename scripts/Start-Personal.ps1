$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
$privateDirectory = Join-Path $projectDirectory '.personal'
$tunnelExecutable = Join-Path $projectDirectory '.tools/cloudflared.exe'
$serverFile = Join-Path $projectDirectory 'apps/server/dist/index.js'
$stateFile = Join-Path $privateDirectory 'launch.json'
$accessFile = Join-Path $privateDirectory 'access.json'
$localAddress = 'http://127.0.0.1:3002'

if (!(Test-Path -LiteralPath $serverFile)) { throw 'Run pnpm build first.' }
if (!(Test-Path -LiteralPath $tunnelExecutable)) {
  throw 'Download the official cloudflared-windows-amd64.exe to .tools/cloudflared.exe. See README.md.'
}
New-Item -ItemType Directory -Force -Path $privateDirectory | Out-Null
if (Test-Path -LiteralPath $stateFile) {
  $savedState = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
  $runningServer = Get-Process -Id $savedState.serverProcessId -ErrorAction SilentlyContinue
  $runningTunnel = Get-Process -Id $savedState.tunnelProcessId -ErrorAction SilentlyContinue
  if ($runningServer -and $runningTunnel -and $runningServer.StartTime.ToUniversalTime().ToString('o') -eq $savedState.serverStartedAt -and $runningTunnel.StartTime.ToUniversalTime().ToString('o') -eq $savedState.tunnelStartedAt) {
    Write-Output "Site is already running: $($savedState.url)"
    Write-Output "Login details: $accessFile"
    return
  }
  if ($runningServer -and $runningServer.StartTime.ToUniversalTime().ToString('o') -eq $savedState.serverStartedAt) {
    throw 'The previous server is still running. Run pnpm personal:stop, then retry.'
  }
}
if (!(Test-Path -LiteralPath $accessFile)) {
  $randomBytes = New-Object byte[] 32
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($randomBytes) } finally { $generator.Dispose() }
  $access = @{ username = 'roman'; password = [Convert]::ToBase64String($randomBytes).TrimEnd('=').Replace('+', '-').Replace('/', '_') }
  [IO.File]::WriteAllText($accessFile, ($access | ConvertTo-Json))
}
$access = Get-Content -LiteralPath $accessFile -Raw | ConvertFrom-Json
$env:NODE_ENV = 'production'
$env:HOST = '127.0.0.1'
$env:PORT = '3002'
$env:APP_USERNAME = $access.username
$env:APP_PASSWORD = $access.password
$env:DATABASE_PATH = Join-Path $projectDirectory 'apps/server/storage/turkish-flashcards.db'
$env:IMPORT_PACKAGE_DIRECTORY = Join-Path $privateDirectory 'dictionary-import'
$authorization = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("$($access.username):$($access.password)"))
$nodeExecutable = (Get-Command node -ErrorAction Stop).Source
$serverProcess = $null
$tunnelProcess = $null
try {
  $serverProcess = Start-Process -FilePath $nodeExecutable -ArgumentList @('--disable-warning=ExperimentalWarning', ('"' + $serverFile + '"')) -WorkingDirectory $projectDirectory -WindowStyle Hidden -RedirectStandardOutput (Join-Path $privateDirectory 'server.log') -RedirectStandardError (Join-Path $privateDirectory 'server.err') -PassThru
  $ready = $false
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    if ($serverProcess.HasExited) { throw 'Server exited. See .personal/server.err.' }
    try {
      $response = Invoke-RestMethod -Uri "$localAddress/api/stats" -Headers @{ Authorization = $authorization } -TimeoutSec 2
      if ($null -ne $response.entries) { $ready = $true; break }
    } catch { Start-Sleep -Milliseconds 500 }
  }
  if (!$ready) { throw 'Server did not start. See .personal/server.err.' }
  # Ensure the health response did not come from an older process using this port.
  Start-Sleep -Milliseconds 300
  $serverProcess.Refresh()
  if ($serverProcess.HasExited) { throw 'Port 3002 is already in use. See .personal/server.err.' }
  $tunnelErrorLog = Join-Path $privateDirectory 'tunnel.err'
  $tunnelProcess = Start-Process -FilePath $tunnelExecutable -ArgumentList @('tunnel', '--url', $localAddress, '--no-autoupdate') -WorkingDirectory $projectDirectory -WindowStyle Hidden -RedirectStandardOutput (Join-Path $privateDirectory 'tunnel.log') -RedirectStandardError $tunnelErrorLog -PassThru
  $publicUrl = $null
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    if ($tunnelProcess.HasExited) { throw 'Tunnel exited. See .personal/tunnel.err.' }
    if (Test-Path -LiteralPath $tunnelErrorLog) {
      $logText = Get-Content -LiteralPath $tunnelErrorLog -Raw
      if ($logText) {
        $match = [regex]::Match($logText, 'https://[a-z0-9-]+\.trycloudflare\.com')
        if ($match.Success) { $publicUrl = $match.Value; break }
      }
    }
    Start-Sleep -Milliseconds 500
  }
  if (!$publicUrl) { throw 'Tunnel URL did not appear. See .personal/tunnel.err.' }
  $state = @{
    serverProcessId = $serverProcess.Id
    serverStartedAt = $serverProcess.StartTime.ToUniversalTime().ToString('o')
    tunnelProcessId = $tunnelProcess.Id
    tunnelStartedAt = $tunnelProcess.StartTime.ToUniversalTime().ToString('o')
    url = $publicUrl
  }
  [IO.File]::WriteAllText($stateFile, ($state | ConvertTo-Json))
  Write-Output "Site: $publicUrl"
  Write-Output "Login details: $accessFile"
  Write-Output 'Keep this computer awake. Stop with pnpm personal:stop.'
} catch {
  if ($tunnelProcess -and !$tunnelProcess.HasExited) { Stop-Process -Id $tunnelProcess.Id -ErrorAction SilentlyContinue }
  if ($serverProcess -and !$serverProcess.HasExited) { Stop-Process -Id $serverProcess.Id -ErrorAction SilentlyContinue }
  throw
}
