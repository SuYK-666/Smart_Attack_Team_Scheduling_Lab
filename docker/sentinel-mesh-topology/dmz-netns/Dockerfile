FROM alpine:3.20

RUN apk add --no-cache iproute2 iptables iptables-legacy

COPY route-guardian.sh /usr/local/sbin/route-guardian.sh
RUN chmod 0755 /usr/local/sbin/route-guardian.sh

ENTRYPOINT ["/usr/local/sbin/route-guardian.sh"]
