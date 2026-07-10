$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host '== Compose status =='
docker compose ps

Write-Host "`n== Published entry checks =="
$entry = Invoke-WebRequest -Uri 'http://127.0.0.1:18081/' -UseBasicParsing
Write-Host "entry01 HTTP status: $($entry.StatusCode)"

Write-Host "`n== Network reachability from dev01 =="
docker exec sentinel-dev01 ping -c 1 10.92.30.20
docker exec sentinel-dev01 ping -c 1 10.92.30.53

Write-Host "`n== DNS query through CoreDNS =="
docker exec sentinel-dev01 nslookup git01.sentinel.local 10.92.30.53
docker exec sentinel-dev01 nslookup minio01.sentinel.local 10.92.30.53

Write-Host "`n== Service protocol checks from dev01 =="
docker exec sentinel-dev01 nc -zv 10.92.20.10 80
docker exec sentinel-dev01 nc -zv 10.92.20.11 8983
docker exec sentinel-dev01 nc -zv 10.92.20.20 80
docker exec sentinel-dev01 nc -zv 10.92.30.20 3306
docker exec sentinel-dev01 nc -zv 10.92.30.30 5984
docker exec sentinel-dev01 nc -zv 10.92.30.40 21
docker exec sentinel-dev01 nc -zv 10.92.30.50 9000

Write-Host "`n== Flag placement checks =="
docker exec sentinel-entry01 test -f /flag.txt
docker exec sentinel-wiki01 test -f /flag.txt
docker exec sentinel-git01 test -f /flag.txt
docker exec sentinel-cache01 test -f /flag.txt
docker exec sentinel-files01 test -f /flag.txt
$minioInitLogs = (cmd /c "docker logs sentinel-minio-init 2>&1") -join "`n"
if ($minioInitLogs -notmatch 'seeded s3://flag/flag.txt') {
  throw 'MinIO flag seed log was not found'
}

Write-Host "`nSentinel Mesh deployment checks completed."
