CREATE DATABASE IF NOT EXISTS sentinel_ops;
USE sentinel_ops;

CREATE TABLE IF NOT EXISTS staff_directory (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(64) NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL,
  role_name VARCHAR(128) NOT NULL,
  ldap_dn VARCHAR(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS service_notes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  service_name VARCHAR(64) NOT NULL,
  endpoint VARCHAR(255) NOT NULL,
  note TEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS deployment_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  token_name VARCHAR(64) NOT NULL,
  token_value VARCHAR(255) NOT NULL,
  scope_hint VARCHAR(255) NOT NULL
);

INSERT INTO staff_directory (username, email, role_name, ldap_dn) VALUES
  ('mchen', 'mchen@sentinel.local', 'platform lead', 'uid=mchen,ou=people,dc=sentinel,dc=local'),
  ('rpatel', 'rpatel@sentinel.local', 'storage maintainer', 'uid=rpatel,ou=people,dc=sentinel,dc=local'),
  ('jumpop', 'jumpop@sentinel.local', 'bastion operator', 'uid=jumpop,ou=svc,dc=sentinel,dc=local')
ON DUPLICATE KEY UPDATE email = VALUES(email), role_name = VALUES(role_name);

INSERT INTO service_notes (service_name, endpoint, note) VALUES
  ('solr', 'http://wiki01.sentinel.local:8983/solr/', 'Wiki search core is maintained by platform. The seed import path is /opt/solr/server/solr/seed.'),
  ('gitlab', 'http://git01.sentinel.local/', 'Legacy import testing is still enabled for image attachments. See repo notes in /opt/sentinel-seed.'),
  ('couchdb', 'http://cache01.sentinel.local:5984/', 'Session cache database name is sentinel_sessions. Operators still use the old admin bootstrap workflow.'),
  ('proftpd', 'ftp://files01.sentinel.local/', 'Backup sync writes to /var/ftp/data and occasionally mirrors public artifacts.'),
  ('minio', 'http://minio01.sentinel.local:9000/', 'Object bucket name for validation is flag. Credentials are not stored in DNS or intranet pages.')
ON DUPLICATE KEY UPDATE note = VALUES(note);

INSERT INTO deployment_tokens (token_name, token_value, scope_hint) VALUES
  ('couchdb-bootstrap', 'couchdb_bootstrap_admin:SentinelCouch-Seed!', 'cache01 administrative bootstrap note'),
  ('storage-runbook', 'MINIO_ROOT_USER=minioadmin; MINIO_ROOT_PASSWORD=MinioRoot-Sentinel!', 'MinIO cluster maintenance runbook reference')
ON DUPLICATE KEY UPDATE token_value = VALUES(token_value);
