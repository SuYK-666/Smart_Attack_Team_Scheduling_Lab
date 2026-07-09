#!/bin/sh
set -e

if [ -n "$LAB_ROUTES" ]; then
  for route in $LAB_ROUTES; do
    cidr="${route%%:*}"
    gateway="${route#*:}"
    if [ -n "$cidr" ] && [ -n "$gateway" ] && [ "$cidr" != "$gateway" ]; then
      ip route replace "$cidr" via "$gateway" || true
    fi
  done
fi

if [ "$#" -gt 0 ]; then
  exec "$@"
fi

if command -v catalina.sh >/dev/null 2>&1; then
  exec catalina.sh run
fi

exec /bin/sh -c 'echo "No default command was supplied for entry01" >&2; sleep infinity'
