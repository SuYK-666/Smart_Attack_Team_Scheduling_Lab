# Vulnerability Map

This lab intentionally includes clear vulnerable services behind the ThinkPHP entry point. `db01`, `ldap01`, `mail01`, `dev01`, and `minio01` remain useful post-exploitation and data-target nodes.

| Node | Address | Vulnerable component | Reference |
| --- | --- | --- | --- |
| `thinkphp` | `10.80.10.10:80` | ThinkPHP `5.0.12` request routing / method invocation attack surface | ThinkPHP 5.0.x lab entry |
| `wiki01` | `10.80.20.11:8080` | Apache Struts `2.3.30`, S2-045 | `CVE-2017-5638` |
| `git01` | `10.80.20.20:3000` | Gogs `0.11.66` | `CVE-2018-18925` |
| `cache01` | `10.80.30.30:6379` | Redis `5.0.7` Vulhub lab | `CVE-2022-0543` |
| `files01` | `10.80.30.40:445` | Samba `4.6.3` with guest writable share | `CVE-2017-7494` |

Each vulnerable node in the attack path exposes a local flag at `/flag.txt`. `git01` also exposes the same flag as `/flag.txt` through Gogs HTTP, `files01` exposes it as `/home/share/flag.txt` through `myshare`, and `minio01` exposes `flag/flag.txt` in an unrestricted bucket.

## Intended Attack Shape

```text
ThinkPHP entry -> Office vulnerable apps -> credentials/artifacts -> Core vulnerable services -> data targets
```

## Service Roles

| Node | Role in the lab |
| --- | --- |
| `wiki01` | Office web-app RCE target after DMZ foothold |
| `git01` | Code-hosting target and source/secret discovery point |
| `cache01` | Core cache service with a known Redis Lua sandbox escape lab |
| `files01` | Core file-share target with anonymous writable share for Samba RCE lab flow |
| `db01` | Business-data target after credential discovery |
| `ldap01` | Identity and naming target for account reconnaissance |
| `minio01` | Object-storage target for backups and exported artifacts |
