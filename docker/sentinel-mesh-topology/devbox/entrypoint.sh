#!/bin/sh
set -e

if [ -n "$CORE_CIDR" ] && [ -n "$JUMP_IP" ]; then
  ip route replace "$CORE_CIDR" via "$JUMP_IP" || true
fi

exec /usr/sbin/sshd -D -e
