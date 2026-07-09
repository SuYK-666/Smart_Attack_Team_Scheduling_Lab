FROM alpine:3.20

RUN apk add --no-cache \
      bash bind-tools curl git iproute2 iputils mariadb-client netcat-openbsd \
      jq nmap openldap-clients openssh openssh-server postgresql-client redis samba-client vim wget \
    && adduser -D -s /bin/ash analyst \
    && echo 'analyst:Analyst123!' | chpasswd \
    && ssh-keygen -A \
    && mkdir -p /run/sshd \
    && sed -i 's/^#PasswordAuthentication.*/PasswordAuthentication yes/' /etc/ssh/sshd_config \
    && printf '\nAllowUsers analyst\n' >> /etc/ssh/sshd_config

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
