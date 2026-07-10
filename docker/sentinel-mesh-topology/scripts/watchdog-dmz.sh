#!/usr/bin/env sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

if ! docker exec sentinel-entry01-netns sh -c "
  ip route show 10.92.20.0/24 | grep -Fq 'via 10.92.10.20' &&
  ip route show 10.92.30.0/24 | grep -Fq 'via 10.92.10.20' &&
  iptables -C OUTPUT -j SENTINEL_DMZ_EGRESS
"; then
  echo '[watchdog-dmz] recreating the DMZ network namespace and application'
  docker compose up -d --force-recreate entry01-netns entry01
elif ! curl -fsS --max-time 5 "http://127.0.0.1:${ENTRY_PORT:-18081}/" >/dev/null; then
  echo '[watchdog-dmz] recreating the DMZ application'
  docker compose up -d --no-deps --force-recreate entry01
fi
