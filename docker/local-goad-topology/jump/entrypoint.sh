#!/bin/sh
set -e

sysctl -w net.ipv4.ip_forward=1 >/dev/null 2>&1 || true

for rule in \
  "10.80.10.0/24 10.80.20.0/24" \
  "10.80.10.0/24 10.80.30.0/24" \
  "10.80.20.0/24 10.80.30.0/24"; do
  set -- $rule
  src="$1"
  dst="$2"
  iptables -C FORWARD -s "$src" -d "$dst" -j ACCEPT 2>/dev/null \
    || iptables -A FORWARD -s "$src" -d "$dst" -j ACCEPT
  iptables -C FORWARD -s "$dst" -d "$src" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT 2>/dev/null \
    || iptables -A FORWARD -s "$dst" -d "$src" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
  iptables -t nat -C POSTROUTING -s "$src" -d "$dst" -j MASQUERADE 2>/dev/null \
    || iptables -t nat -A POSTROUTING -s "$src" -d "$dst" -j MASQUERADE
done

exec /usr/sbin/sshd -D -e
