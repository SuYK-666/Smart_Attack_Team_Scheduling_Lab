FROM alpine:3.20

RUN apk add --no-cache samba samba-common-tools \
    && addgroup -S files \
    && adduser -D -H -s /sbin/nologin -G files analyst \
    && echo 'analyst:FilesPass123!' | chpasswd \
    && printf 'FilesPass123!\nFilesPass123!\n' | smbpasswd -a -s analyst

COPY smb.conf /etc/samba/smb.conf
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 139 445
ENTRYPOINT ["/entrypoint.sh"]
