#!/usr/bin/env sh
set -eu

entry_url="http://127.0.0.1:${ENTRY_PORT:-18081}/"
curl -fsS --max-time 5 "$entry_url" >/dev/null
docker exec sentinel-entry01-netns ip route get 10.92.20.10 | grep -Fq 'via 10.92.10.20'
docker exec sentinel-entry01-netns ip route get 10.92.30.30 | grep -Fq 'via 10.92.10.20'
docker exec sentinel-entry01 test -r /flag.txt
echo 'DMZ health, routes, and flag mount verified.'
