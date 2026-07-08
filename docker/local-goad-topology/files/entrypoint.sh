#!/bin/sh
set -e

mkdir -p /run/samba /var/log/samba /srv/samba/public /srv/samba/finance
chown -R analyst:files /srv/samba
chmod 0775 /srv/samba/public /srv/samba/finance

if [ ! -f /srv/samba/public/readme.txt ]; then
  printf 'Public share for the Linux enterprise lab.\n' > /srv/samba/public/readme.txt
fi

if [ ! -f /srv/samba/finance/q3_forecast.txt ]; then
  printf 'Synthetic finance forecast data for lab validation.\n' > /srv/samba/finance/q3_forecast.txt
fi

exec smbd --foreground --no-process-group -s /etc/samba/smb.conf
