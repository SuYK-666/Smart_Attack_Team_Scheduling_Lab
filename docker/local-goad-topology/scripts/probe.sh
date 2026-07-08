set -eu

for target in \
  "10.80.20.10 80 intranet" \
  "10.80.20.11 8080 wiki01-struts" \
  "10.80.20.20 3000 git01" \
  "10.80.20.30 1025 mail01-smtp" \
  "10.80.20.50 22 dev01-ssh" \
  "10.80.30.10 389 ldap01" \
  "10.80.30.20 3306 db01" \
  "10.80.30.30 6379 cache01" \
  "10.80.30.40 445 files01" \
  "10.80.30.50 9000 minio01" \
  "10.80.30.53 53 dns01"; do
  set -- $target
  printf '%-14s %s:%s ... ' "$3" "$1" "$2"
  nc -vz -w 5 "$1" "$2" >/tmp/probe.out 2>&1
  cat /tmp/probe.out
done
