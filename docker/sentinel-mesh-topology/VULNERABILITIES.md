# Sentinel Mesh Vulnerability Map

The range intentionally includes six CVE-oriented targets and exactly six flags. Auxiliary services provide routing, clues, credentials, directory data, mail, and seed records only.

| Node | Address | Vulnerable component | Flag |
| --- | --- | --- | --- |
| `entry01` | `10.92.10.10:80` | Apache HTTP Server 2.4.50 path traversal / CGI RCE, `CVE-2021-42013` | `/flag.txt` |
| `wiki01` | `10.92.20.11:8983` | Apache Solr VelocityResponseWriter RCE, `CVE-2019-17558` | `/flag.txt` |
| `git01` | `10.92.20.20:80` | GitLab ExifTool RCE, `CVE-2021-22205` | `/flag.txt` |
| `cache01` | `10.92.30.30:5984` | CouchDB privilege and command chain, `CVE-2017-12635` / `CVE-2017-12636` | `/flag.txt` |
| `files01` | `10.92.30.40:21` | ProFTPD 1.3.5 mod_copy, `CVE-2015-3306` | `/flag.txt`; copy it into the writable anonymous FTP area through the vulnerability |
| `minio01` | `10.92.30.50:9000/9001` | MinIO cluster information disclosure shape, `CVE-2023-28432` | `s3://flag/flag.txt` |

## Intended Attack Shape

```text
host
  -> entry01 / Apache HTTPD path traversal and CGI RCE / flag 1
  -> jump01 / router and SSH pivot
  -> intranet / internal service clues
  -> wiki01 / Solr RCE / flag 2
  -> git01 / GitLab RCE plus repo clues / flag 3
  -> cache01 / CouchDB chain / flag 4
  -> files01 / ProFTPD mod_copy / flag 5
  -> minio01 / MinIO cluster clue and bucket / flag 6
```

## Non-Flag Clue Nodes

| Node | Role |
| --- | --- |
| `jump01` | Route and SSH pivot only |
| `intranet` | Internal links, DNS aliases, and operator hints |
| `mail01` | Mailpit messages and reset or maintenance clues |
| `dev01` | Internal workstation and network tooling |
| `ldap01` | User and group enumeration target |
| `db01` | Operations data, service endpoints, and credential hints |
| `dns01` | `sentinel.local` resolution and CNAME clues |
