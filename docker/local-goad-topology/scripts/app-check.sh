set -eu

printf 'dev01 route to core ... '
ip route | grep -q '10.80.30.0/24 via 10.80.20.254'
printf 'ok\n'

printf 'MariaDB seeded customers ... '
mariadb -h 10.80.30.20 -uapp_svc -pAppSvcPass123! app_prod -N -e 'select count(*) from customers;'

printf 'Struts wiki HTTP ... '
curl -fsS -o /dev/null -w '%{http_code}\n' http://10.80.20.11:8080/

printf 'Gogs HTTP ... '
curl -fsS -o /dev/null -w '%{http_code}\n' http://10.80.20.20:3000/

printf 'Redis ping ... '
redis-cli -h 10.80.30.30 ping

printf 'LDAP base DN ... '
ldapsearch -x -H ldap://10.80.30.10 -D 'cn=admin,dc=corp,dc=local' -w 'AdminPassw0rd!' -b 'dc=corp,dc=local' -s base dn | grep '^dn:'

printf 'Samba shares ...\n'
smbclient -L //10.80.30.40 -N -m SMB3 | grep 'myshare'

printf 'MinIO health ... '
curl -fsS -o /dev/null -w '%{http_code}\n' http://10.80.30.50:9000/minio/health/live
