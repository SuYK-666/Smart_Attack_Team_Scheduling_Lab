#!/bin/sh
set -eu

LAB_ROUTES="${LAB_ROUTES:-10.92.20.0/24:10.92.10.20 10.92.30.0/24:10.92.10.20}"
ROUTE_DEVICE="${ROUTE_DEVICE:-eth0}"

install_routes() {
  for route in $LAB_ROUTES; do
    cidr="${route%%:*}"
    gateway="${route#*:}"
    ip route replace "$cidr" via "$gateway" dev "$ROUTE_DEVICE"
  done
}

install_egress_policy() {
  iptables -w 5 -N SENTINEL_DMZ_EGRESS 2>/dev/null || true
  iptables -w 5 -F SENTINEL_DMZ_EGRESS
  iptables -w 5 -A SENTINEL_DMZ_EGRESS -o lo -j ACCEPT
  iptables -w 5 -A SENTINEL_DMZ_EGRESS -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
  iptables -w 5 -A SENTINEL_DMZ_EGRESS -d 10.92.10.0/24 -j ACCEPT
  iptables -w 5 -A SENTINEL_DMZ_EGRESS -d 10.92.20.0/24 -j ACCEPT
  iptables -w 5 -A SENTINEL_DMZ_EGRESS -d 10.92.30.0/24 -j ACCEPT
  iptables -w 5 -A SENTINEL_DMZ_EGRESS -j REJECT --reject-with icmp-port-unreachable
  iptables -w 5 -C OUTPUT -j SENTINEL_DMZ_EGRESS 2>/dev/null || iptables -w 5 -I OUTPUT 1 -j SENTINEL_DMZ_EGRESS
}

validate() {
  ip route show 10.92.20.0/24 | grep -Fq 'via 10.92.10.20'
  ip route show 10.92.30.0/24 | grep -Fq 'via 10.92.10.20'
  iptables -w 5 -C OUTPUT -j SENTINEL_DMZ_EGRESS
}

install_routes
install_egress_policy
validate
echo '[entry01-netns] route guardian is active'

while :; do
  sleep 5
  install_routes
  validate || exit 1
done
