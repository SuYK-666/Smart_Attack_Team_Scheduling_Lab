FROM alpine:3.19

RUN apk add --no-cache iproute2 iptables iptables-legacy curl netcat-openbsd tcpdump bind-tools openssh-server bash \
    && adduser -D -s /bin/ash jumpop \
    && echo 'jumpop:JumpPass123!' | chpasswd \
    && ssh-keygen -A \
    && mkdir -p /run/sshd \
    && sed -i 's/^#PasswordAuthentication.*/PasswordAuthentication yes/' /etc/ssh/sshd_config \
    && printf '\nAllowUsers jumpop\n' >> /etc/ssh/sshd_config

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
