param(
  [ValidateSet('start', 'stop', 'status')][string]$Action = 'start',
  [ValidateRange(1024, 65535)][int]$Port = 8787
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$dataDirectory = Join-Path $projectRoot '.felix-web-data'
$processRecord = Join-Path $dataDirectory '.local-web.process'

function Get-LocalServer {
  if (!(Test-Path -LiteralPath $processRecord)) { return $null }
  $record = Get-Content -LiteralPath $processRecord -Raw | ConvertFrom-Json
  $process = Get-Process -Id $record.pid -ErrorAction SilentlyContinue
  # Refuse to stop a different process if Windows has reused this PID.
  if ($process -and $process.ProcessName -eq 'bun' -and $process.StartTime.ToUniversalTime().ToString('o') -eq $record.started) {
    return @{ process = $process; port = $record.port }
  }
  return $null
}

$server = Get-LocalServer
if ($Action -eq 'stop') {
  if ($server) { Stop-Process -Id $server.process.Id; $server.process.WaitForExit(10000) | Out-Null }
  if (Test-Path -LiteralPath $processRecord) { Remove-Item -LiteralPath $processRecord }
  Write-Output 'Felix local web stopped. Your SQLite data is retained.'
  exit 0
}
if ($server) {
  $url = 'http://127.0.0.1:' + $server.port
  $health = Invoke-RestMethod -Uri ($url + '/healthz') -TimeoutSec 3
  if (!$health.ok -or $health.service -ne 'felix-web') { throw 'The local Felix process is running but is not healthy.' }
  Write-Output "Felix local web is running: $url (database: $($health.database))"
  exit 0
}
if ($Action -eq 'status') { Write-Output 'Felix local web is stopped.'; exit 0 }

if (!(Test-Path -LiteralPath (Join-Path $projectRoot 'apps/web/dist/index.html'))) { throw 'Build the web app first: bun run web:build' }
$bunCommand = Get-Command bun -ErrorAction Stop
$socket = New-Object System.Net.Sockets.TcpClient
try {
  $connection = $socket.ConnectAsync('127.0.0.1', $Port)
  try { $connection.Wait(500) | Out-Null } catch {}
  if ($socket.Connected) { throw "Port $Port is occupied. Choose another -Port or stop its owner." }
} finally { $socket.Dispose() }

New-Item -ItemType Directory -Path $dataDirectory -Force | Out-Null
$settings = @{
  HOST = '127.0.0.1'; PORT = [string]$Port; NODE_ENV = 'development';
  FELIX_DATA_DIR = $dataDirectory; FELIX_DATABASE_TYPE = 'sqlite'; FELIX_DATABASE_URL = '';
  FELIX_STATIC_DIR = (Join-Path $projectRoot 'apps/web/dist');
  FELIX_SKILLS_DIR = (Join-Path $projectRoot 'skills'); FELIX_DEMO_DATA = '1'; TZ = 'Asia/Shanghai';
  FELIX_COOKIE_SECRET = ''; FELIX_PUBLIC_ORIGIN = ''; FELIX_PROXY_SECRET = ''; FELIX_INVITE_CODE = ''
}
$originalSettings = @{}
try {
  foreach ($name in $settings.Keys) {
    $originalSettings[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    [Environment]::SetEnvironmentVariable($name, $settings[$name], 'Process')
  }
  # Disable implicit .env loading so desktop credentials never configure this web deployment.
  $child = Start-Process -FilePath $bunCommand.Source -ArgumentList @('--no-env-file', 'apps/server/src/index.ts') -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $dataDirectory '.local-web.stdout.log') -RedirectStandardError (Join-Path $dataDirectory '.local-web.stderr.log')
} finally {
  foreach ($name in $settings.Keys) { [Environment]::SetEnvironmentVariable($name, $originalSettings[$name], 'Process') }
}
@{ pid = $child.Id; started = $child.StartTime.ToUniversalTime().ToString('o'); port = $Port } | ConvertTo-Json | Set-Content -LiteralPath $processRecord -Encoding UTF8
$url = "http://127.0.0.1:$Port"
for ($attempt = 0; $attempt -lt 60; $attempt++) {
  $child.Refresh()
  if ($child.HasExited) { throw 'Felix startup failed. Inspect .felix-web-data/.local-web.stderr.log.' }
  try {
    $health = Invoke-RestMethod -Uri ($url + '/healthz') -TimeoutSec 2
    if ($health.ok -and $health.service -eq 'felix-web' -and $health.database -eq 'sqlite') {
      Write-Output "Felix local web started: $url (SQLite, sample market data)"
      Write-Output "Data: $dataDirectory"
      exit 0
    }
  } catch {}
  Start-Sleep -Milliseconds 250
}
throw 'Felix did not become healthy. Inspect .felix-web-data/.local-web.stderr.log.'
