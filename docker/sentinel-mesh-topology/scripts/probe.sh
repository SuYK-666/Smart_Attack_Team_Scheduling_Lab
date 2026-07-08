set -eu

for target in \
  "10.92.20.10 80 intranet" \
  "10.92.20.11 8983 wiki01-solr" \
  "10.92.20.20 80 git01" \
  "10.92.20.30 1025 mail01-smtp" \
  "10.92.20.50 22 dev01-ssh" \
  "10.92.30.10 389 ldap01" \
  "10.92.30.20 3306 db01" \
  "10.92.30.30 5984 cache01-couchdb" \
  "10.92.30.40 21 files01-ftp" \
  "10.92.30.50 9000 minio01" \
  "10.92.30.53 53 dns01"; do
  set -- $target
  printf '%-16s %s:%s ... ' "$3" "$1" "$2"
  nc -vz -w 5 "$1" "$2" >/tmp/probe.out 2>&1
  cat /tmp/probe.out
done
