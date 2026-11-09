param([switch]$Monitor)
$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
$privateDirectory = Join-Path $projectDirectory '.personal'
. (Join-Path $PSScriptRoot 'Personal-Common.ps1')
$tunnelExecutable = Join-Path $projectDirectory '.tools/cloudflared.exe'
$serverFile = Join-Path $projectDirectory 'apps/server/dist/index.js'
$stateFile = Join-Path $privateDirectory 'launch.json'
$accessFile = Join-Path $privateDirectory 'access.json'
$disabledFile = Join-Path $privateDirectory 'stopped'
$localAddress = 'http://127.0.0.1:3002'
if (!(Test-Path -LiteralPath $serverFile)) { throw 'Run pnpm build first.' }
if (!(Test-Path -LiteralPath $tunnelExecutable)) { throw 'Download cloudflared to .tools/cloudflared.exe. See README.md.' }
$lifecycleLock = Open-PersonalLock $privateDirectory
try {
  if ($Monitor -and (Test-Path -LiteralPath $disabledFile)) { return }
  if (!$Monitor -and (Test-Path -LiteralPath $disabledFile)) { Remove-Item -LiteralPath $disabledFile }
  $savedState = $null
  if (Test-Path -LiteralPath $stateFile) { $savedState = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json }
  $serverProcess = Get-PersonalProcess $savedState 'server'
  $tunnelProcess = Get-PersonalProcess $savedState 'tunnel'
  $state = @{}
  if ($savedState) { foreach ($property in $savedState.PSObject.Properties) { $state[$property.Name] = $property.Value } }
  if (!(Test-Path -LiteralPath $accessFile)) {
    $randomBytes = New-Object byte[] 32
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($randomBytes) } finally { $generator.Dispose() }
    $access = @{ username = 'roman'; password = [Convert]::ToBase64String($randomBytes).TrimEnd('=').Replace('+', '-').Replace('/', '_') }
    [IO.File]::WriteAllText($accessFile, ($access | ConvertTo-Json))
  }
  $access = Get-Content -LiteralPath $accessFile -Raw | ConvertFrom-Json
  $authorization = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("$($access.username):$($access.password)"))
  $healthy = $false
  if ($serverProcess) {
    for ($attempt = 0; $attempt -lt 3; $attempt++) {
      try {
        $response = Invoke-RestMethod -Uri "$localAddress/api/stats" -Headers @{ Authorization = $authorization } -TimeoutSec 5
        if ($null -ne $response.entries) { $healthy = $true; break }
      } catch { Start-Sleep -Milliseconds 500 }
    }
    if (!$healthy) { Stop-Process -Id $serverProcess.Id; $serverProcess.WaitForExit(); $serverProcess = $null }
  }
  if (!$serverProcess) {
    # Never replace an unrelated listener on this port.
    $listener = Get-NetTCPConnection -LocalPort 3002 -State Listen -ErrorAction SilentlyContinue
    if ($listener) { throw 'Port 3002 is occupied by an untracked process; it was left untouched.' }
    $env:NODE_ENV = 'production'
    $env:HOST = '127.0.0.1'
    $env:PORT = '3002'
    $env:APP_USERNAME = $access.username
    $env:APP_PASSWORD = $access.password
    $env:DATABASE_PATH = Join-Path $projectDirectory 'apps/server/storage/turkish-flashcards.db'
    $env:IMPORT_PACKAGE_DIRECTORY = Join-Path $privateDirectory 'dictionary-import'
    $serverProcess = Start-Process -FilePath (Get-Command node -ErrorAction Stop).Source -ArgumentList @('--disable-warning=ExperimentalWarning', ('"' + $serverFile + '"')) -WorkingDirectory $projectDirectory -WindowStyle Hidden -RedirectStandardOutput (Join-Path $privateDirectory 'server.log') -RedirectStandardError (Join-Path $privateDirectory 'server.err') -PassThru
    $state.serverProcessId = $serverProcess.Id
    $state.serverStartedAt = $serverProcess.StartTime.ToUniversalTime().ToString('o')
    Save-PersonalState $state $stateFile
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
      $serverProcess.Refresh()
      if ($serverProcess.HasExited) { throw 'Server exited. See .personal/server.err.' }
      try {
        $response = Invoke-RestMethod -Uri "$localAddress/api/stats" -Headers @{ Authorization = $authorization } -TimeoutSec 2
        if ($null -ne $response.entries) { $healthy = $true; break }
      } catch { Start-Sleep -Milliseconds 500 }
    }
    if (!$healthy) { throw 'Server did not become ready. See .personal/server.err.' }
  }
  $publicUrl = $state.url
  $tunnelLog = Join-Path $privateDirectory 'tunnel.err'
  if (!$tunnelProcess) {
    $configurationFile = Join-Path $privateDirectory 'tunnel.json'
    if (Test-Path -LiteralPath $configurationFile) {
      $configuration = Get-Content -LiteralPath $configurationFile -Raw | ConvertFrom-Json
      $publicUri = [uri]$configuration.url
      if (!$publicUri.IsAbsoluteUri -or $publicUri.Scheme -ne 'https' -or $publicUri.UserInfo -or $publicUri.AbsolutePath -ne '/' -or $publicUri.Query -or $publicUri.Fragment) { throw 'tunnel.json must contain an HTTPS origin in url.' }
      $tokenFile = Join-Path $privateDirectory 'tunnel-token.txt'
      if (!(Test-Path -LiteralPath $tokenFile)) { throw 'Missing .personal/tunnel-token.txt.' }
      $tunnelArguments = @('tunnel', '--no-autoupdate', 'run', '--token-file', ('"' + $tokenFile + '"'))
      $publicUrl = $publicUri.GetLeftPart([UriPartial]::Authority)
    } else {
      $tunnelArguments = @('tunnel', '--url', $localAddress, '--no-autoupdate')
      $publicUrl = $null
    }
    $tunnelProcess = Start-Process -FilePath $tunnelExecutable -ArgumentList $tunnelArguments -WorkingDirectory $projectDirectory -WindowStyle Hidden -RedirectStandardOutput (Join-Path $privateDirectory 'tunnel.log') -RedirectStandardError $tunnelLog -PassThru
    $state.tunnelProcessId = $tunnelProcess.Id
    $state.tunnelStartedAt = $tunnelProcess.StartTime.ToUniversalTime().ToString('o')
    $state.url = $publicUrl
    Save-PersonalState $state $stateFile
  }
  if (!$publicUrl) {
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
      $tunnelProcess.Refresh()
      if ($tunnelProcess.HasExited) { throw 'Tunnel exited. See .personal/tunnel.err.' }
      if (Test-Path -LiteralPath $tunnelLog) {
        $logText = Get-Content -LiteralPath $tunnelLog -Raw
        if ($logText) {
          $urlMatch = [regex]::Match($logText, 'https://[a-z0-9-]+\.trycloudflare\.com')
          if ($urlMatch.Success) { $publicUrl = $urlMatch.Value; break }
        }
      }
      Start-Sleep -Milliseconds 500
    }
  }
  $tunnelProcess.Refresh()
  if ($tunnelProcess.HasExited) { throw 'Tunnel exited. See .personal/tunnel.err.' }
  if (!$publicUrl) { throw 'Tunnel URL did not appear. See .personal/tunnel.err.' }
  $state.url = $publicUrl
  Save-PersonalState $state $stateFile
  [IO.File]::WriteAllText((Join-Path $privateDirectory 'server-url.txt'), $publicUrl)
  Write-Output "Site: $publicUrl"
  Write-Output "Login details: $accessFile"
} finally { $lifecycleLock.Dispose() }
