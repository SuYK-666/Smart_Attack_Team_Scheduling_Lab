CREATE DATABASE IF NOT EXISTS app_prod;
USE app_prod;

CREATE TABLE IF NOT EXISTS customers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  full_name VARCHAR(255) NOT NULL,
  tier VARCHAR(32) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  actor VARCHAR(128) NOT NULL,
  action VARCHAR(255) NOT NULL,
  source_ip VARCHAR(64) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO customers (email, full_name, tier) VALUES
  ('alice@example.corp', 'Alice Chen', 'enterprise'),
  ('bob@example.corp', 'Bob Lin', 'standard'),
  ('carol@example.corp', 'Carol Wang', 'enterprise')
ON DUPLICATE KEY UPDATE tier = VALUES(tier);

INSERT INTO audit_log (actor, action, source_ip) VALUES
  ('svc-web', 'created customer export', '10.80.20.10'),
  ('analyst', 'downloaded quarterly report', '10.80.20.50');
