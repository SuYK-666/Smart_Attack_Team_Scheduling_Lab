FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends proftpd-basic proftpd-mod-crypto \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /var/ftp/data /run/proftpd \
    && useradd -r -d /var/ftp -s /usr/sbin/nologin ftpuser \
    && chown -R ftpuser:ftpuser /var/ftp

COPY proftpd.conf /etc/proftpd/proftpd.conf

EXPOSE 21

CMD ["proftpd", "-n", "-c", "/etc/proftpd/proftpd.conf"]
