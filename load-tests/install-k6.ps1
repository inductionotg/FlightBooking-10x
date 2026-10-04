$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$toolsDirectory = Join-Path $projectRoot '.local/tools'
New-Item -ItemType Directory -Path $toolsDirectory -Force | Out-Null
$archive = Join-Path $toolsDirectory 'k6.zip'
Invoke-WebRequest -Uri 'https://github.com/grafana/k6/releases/download/v2.3.0/k6-v2.3.0-windows-amd64.zip' -OutFile $archive
$expected = '112276d495e5741c968e2bc09ea6196099c1275bd6db9ee0875d173c7148ce43'
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLower() -ne $expected) {
    throw 'k6 archive checksum mismatch; not extracting.'
}
Expand-Archive -LiteralPath $archive -DestinationPath (Join-Path $toolsDirectory 'k6') -Force
& (Join-Path $toolsDirectory 'k6/k6-v2.3.0-windows-amd64/k6.exe') version
