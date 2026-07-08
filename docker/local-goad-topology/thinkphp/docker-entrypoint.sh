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
elif [ -n "$INTERNAL_CIDR" ] && [ -n "$JUMP_IP" ]; then
  ip route replace "$INTERNAL_CIDR" via "$JUMP_IP" || true
fi

exec "$@"
