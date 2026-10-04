$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$logDirectory = Join-Path $projectRoot '.local'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$services = @('Auth_Service', 'FlightandSearchService', 'Booking_Service', 'ReminderService', 'AIRLINE-MANAGEMENT_API_GATEWAY')
foreach ($port in @(3010,3001,3002,3003,3004)) {
    if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -in @('::', '::1') }) {
        throw "Port $port is already in use. Stop the existing service before starting this stack."
    }
}
$started = @()
foreach ($service in $services) {
    $process = Start-Process -FilePath (Get-Command node).Source -ArgumentList 'src/index.js' -WorkingDirectory (Join-Path $projectRoot $service) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDirectory "$service.stdout.log") -RedirectStandardError (Join-Path $logDirectory "$service.stderr.log")
    $started += [PSCustomObject]@{ Service = $service; ProcessId = $process.Id }
}
$started | ConvertTo-Json | Set-Content (Join-Path $logDirectory 'processes.json')
$started | Format-Table
Write-Output 'Processes launched; use the smoke test to verify readiness. Logs are in .local/.'
