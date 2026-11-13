$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$portProbe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 3000)
$portAvailable = $true
try { $portProbe.Start() } catch { $portAvailable = $false }
finally { $portProbe.Stop() }
if (-not $portAvailable) { exit 0 }

$dataPath = Join-Path $projectRoot "data"
New-Item -ItemType Directory -Path $dataPath -Force | Out-Null
$stdoutPath = Join-Path $dataPath "local-dashboard.log"
$stderrPath = Join-Path $dataPath "local-dashboard-error.log"
Push-Location $projectRoot
try {
  & npm.cmd run dev 1>> $stdoutPath 2>> $stderrPath
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
