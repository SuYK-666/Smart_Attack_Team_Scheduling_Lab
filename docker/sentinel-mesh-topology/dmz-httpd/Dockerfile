FROM vulhub/httpd:2.4.50

USER root

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends curl iproute2 netcat-openbsd dnsutils procps; \
    rm -rf /var/lib/apt/lists/*; \
    sed -i 's|#LoadModule cgid_module modules/mod_cgid.so|LoadModule cgid_module modules/mod_cgid.so|' /usr/local/apache2/conf/httpd.conf; \
    sed -i 's|#LoadModule cgi_module modules/mod_cgi.so|LoadModule cgi_module modules/mod_cgi.so|' /usr/local/apache2/conf/httpd.conf; \
    sed -i 's|#Include conf/extra/httpd-autoindex.conf|Include conf/extra/httpd-autoindex.conf|' /usr/local/apache2/conf/httpd.conf; \
    perl -0777 -i -pe 's#<Directory />.*?</Directory>#<Directory />\n    AllowOverride None\n    Require all granted\n</Directory>#s' /usr/local/apache2/conf/httpd.conf; \
    printf '%s\n' 'ServerName entry01' 'ServerTokens Full' 'ServerSignature On' 'PidFile /tmp/httpd.pid' 'ErrorLog /proc/self/fd/2' 'CustomLog /proc/self/fd/1 combined' >> /usr/local/apache2/conf/httpd.conf; \
    mkdir -p /opt/lab-work; \
    httpd -t

COPY index.html /usr/local/apache2/htdocs/index.html
