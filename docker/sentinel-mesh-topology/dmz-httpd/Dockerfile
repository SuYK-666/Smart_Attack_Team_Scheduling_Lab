FROM vulhub/httpd:2.4.50

USER root

RUN set -eux; \
    sed -i 's|deb.debian.org/debian|archive.debian.org/debian|g' /etc/apt/sources.list; \
    sed -i 's|security.debian.org/debian-security|archive.debian.org/debian-security|g' /etc/apt/sources.list; \
    sed -i 's|buster-updates|buster|g' /etc/apt/sources.list; \
    printf 'Acquire::Check-Valid-Until "false";\n' > /etc/apt/apt.conf.d/99archive-no-check-valid-until; \
    apt-get update; \
    apt-get install -y --no-install-recommends curl iproute2 netcat-openbsd dnsutils procps; \
    rm -rf /var/lib/apt/lists/*; \
    sed -i 's|#LoadModule cgid_module modules/mod_cgid.so|LoadModule cgid_module modules/mod_cgid.so|' /usr/local/apache2/conf/httpd.conf; \
    sed -i 's|#LoadModule cgi_module modules/mod_cgi.so|LoadModule cgi_module modules/mod_cgi.so|' /usr/local/apache2/conf/httpd.conf; \
    sed -i 's|#Include conf/extra/httpd-autoindex.conf|Include conf/extra/httpd-autoindex.conf|' /usr/local/apache2/conf/httpd.conf; \
    perl -0777 -i -pe 's#<Directory />.*?</Directory>#<Directory />\n    AllowOverride None\n    Require all granted\n</Directory>#s' /usr/local/apache2/conf/httpd.conf; \
    printf '%s\n' 'ServerName entry01' 'ServerTokens Full' 'ServerSignature On' 'DefaultRuntimeDir /run/httpd' 'PidFile /run/httpd/httpd.pid' 'ScriptSock /run/httpd/cgisock' 'CGIDScriptTimeout 10' 'Timeout 10' 'KeepAlive On' 'KeepAliveTimeout 2' 'MaxKeepAliveRequests 50' 'ErrorLog /proc/self/fd/2' 'CustomLog /proc/self/fd/1 combined' >> /usr/local/apache2/conf/httpd.conf; \
    mkdir -p /opt/lab-work /run/httpd; \
    httpd -t

COPY index.html /usr/local/apache2/htdocs/index.html
