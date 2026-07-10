FROM vulhub/proftpd:1.3.5

# CVE-2015-3306 is a ProFTPD 1.3.5 mod_copy issue.  Do not replace this
# image with a distribution package: supported distributions ship a fixed
# version and would turn files01 into a non-vulnerable FTP service.
RUN mkdir -p /var/ftp/data /run/proftpd \
    && chown -R ftpuser:ftpuser /var/ftp

COPY proftpd.conf /etc/proftpd/proftpd.conf

EXPOSE 21

CMD ["proftpd", "-n", "-c", "/etc/proftpd/proftpd.conf"]
