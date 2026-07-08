set -eu

printf 'dev01 route to core ... '
ip route | grep -q '10.92.30.0/24 via 10.92.20.254'
printf 'ok\n'

printf 'MariaDB seeded notes ... '
mariadb -h 10.92.30.20 -uops_svc -pOpsSvc-Sentinel! sentinel_ops -N -e 'select count(*) from service_notes;'

printf 'Solr HTTP ... '
curl -fsS -o /dev/null -w '%{http_code}\n' http://10.92.20.11:8983/solr/

printf 'GitLab HTTP ... '
curl -fsS -o /dev/null -w '%{http_code}\n' http://10.92.20.20/

printf 'CouchDB HTTP ... '
curl -fsS -o /dev/null -w '%{http_code}\n' http://10.92.30.30:5984/

printf 'LDAP base DN ... '
ldapsearch -x -H ldap://10.92.30.10 -D 'cn=admin,dc=sentinel,dc=local' -w 'LdapAdmin-Sentinel!' -b 'dc=sentinel,dc=local' -s base dn | grep '^dn:'

printf 'ProFTPD port ... '
nc -zv 10.92.30.40 21

printf 'MinIO health ... '
curl -fsS -o /dev/null -w '%{http_code}\n' http://10.92.30.50:9000/minio/health/live
