#!/bin/sh
set -eu

set_ssh_option() {
    file="$1"
    key="$2"
    value="$3"
    if grep -q "^#\?${key}" "$file"; then
        sed -i "s/^#\?${key}.*/${key} ${value}/" "$file"
    else
        printf '\n%s %s\n' "$key" "$value" >> "$file"
    fi
}

root_hash="$(mkpasswd -m sha-512 GitRootPass123!)"
usermod -p "$root_hash" root

for config in /etc/ssh/sshd_config /app/gogs/docker/sshd_config; do
    set_ssh_option "$config" PasswordAuthentication yes
    set_ssh_option "$config" PermitRootLogin yes
    set_ssh_option "$config" UsePAM no
done

if grep -q '^AllowUsers' /app/gogs/docker/sshd_config; then
    sed -i 's/^AllowUsers.*/AllowUsers git root/' /app/gogs/docker/sshd_config
else
    printf '\nAllowUsers git root\n' >> /app/gogs/docker/sshd_config
fi

exec /app/gogs/docker/start.sh "$@"