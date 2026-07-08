import os
import socket
import threading
import time

NODE_NAME = os.getenv("NODE_NAME", "goad-node")
DOMAIN = os.getenv("DOMAIN", "sevenkingdoms.local")
ROLE = os.getenv("ROLE", "member")

PORTS = {
    53: "dns",
    88: "kerberos",
    135: "rpc",
    139: "netbios",
    389: "ldap",
    445: "smb",
    464: "kpasswd",
    593: "rpc-http",
    636: "ldaps",
    3268: "global-catalog",
    3389: "rdp",
    5985: "winrm",
}


def handle_client(conn, service):
    banner = (
        f"{NODE_NAME}.{DOMAIN} role={ROLE} service={service}\n"
        "This is a GOAD-like Docker topology node, not a full Windows AD host.\n"
    ).encode()
    try:
        conn.sendall(banner)
    finally:
        conn.close()


def serve(port, service):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind(("0.0.0.0", port))
        sock.listen(50)
        while True:
            conn, _ = sock.accept()
            threading.Thread(target=handle_client, args=(conn, service), daemon=True).start()


for port, service in PORTS.items():
    threading.Thread(target=serve, args=(port, service), daemon=True).start()

print(f"{NODE_NAME}.{DOMAIN} started as {ROLE}", flush=True)
while True:
    time.sleep(3600)
