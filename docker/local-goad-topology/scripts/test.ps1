$ErrorActionPreference = 'Stop'

$env:DOCKER_CONFIG = 'C:\Users\13313\VirtualBox VMs\GOAD\.docker'
$env:DOCKER_HOST = 'npipe:////./pipe/dockerDesktopLinuxEngine'

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host '== Compose status =='
docker compose ps

Write-Host "`n== HTTP entry =="
$entry = Invoke-WebRequest -Uri 'http://127.0.0.1:18080/' -UseBasicParsing
Write-Host "ThinkPHP entry HTTP status: $($entry.StatusCode)"

Write-Host "`n== Routes from DMZ entry =="
docker exec lab-thinkphp ip route

Write-Host "`n== Port reachability from DMZ entry =="
docker cp (Join-Path $PSScriptRoot 'probe.sh') lab-thinkphp:/tmp/probe.sh
docker exec lab-thinkphp sh /tmp/probe.sh

Write-Host "`n== DNS query through CoreDNS =="
docker exec lab-thinkphp sh -c 'dig +short @10.80.30.53 db01.corp.local'

Write-Host "`n== Service protocol checks from devbox =="
docker cp (Join-Path $PSScriptRoot 'app-check.sh') lab-dev01:/tmp/app-check.sh
docker exec lab-dev01 sh /tmp/app-check.sh
