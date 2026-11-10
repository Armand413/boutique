-- 0001 : sécurité, audit et tables système (Annexe E.2 « Sécurité et audit » et « Système »).

CREATE TABLE roles (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE CHECK (code IN ('admin', 'manager', 'seller')),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0)
) STRICT;

CREATE TABLE permissions (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE CHECK (code GLOB '[a-z]*.[a-z]*'),
  description TEXT NOT NULL CHECK (length(trim(description)) > 0)
) STRICT;

CREATE TABLE role_permissions (
  role_id INTEGER NOT NULL REFERENCES roles (id) ON DELETE RESTRICT,
  permission_id INTEGER NOT NULL REFERENCES permissions (id) ON DELETE RESTRICT,
  PRIMARY KEY (role_id, permission_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE
    CHECK (length(username) BETWEEN 3 AND 32 AND username NOT GLOB '*[^A-Za-z0-9._-]*'),
  full_name TEXT NOT NULL CHECK (length(trim(full_name)) BETWEEN 1 AND 100),
  password_hash TEXT NOT NULL CHECK (password_hash GLOB '$argon2id$*'),
  pin_hash TEXT CHECK (pin_hash IS NULL OR pin_hash GLOB '$argon2id$*'),
  role_id INTEGER NOT NULL REFERENCES roles (id) ON DELETE RESTRICT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
  failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until TEXT CHECK (locked_until IS NULL OR locked_until GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9]*Z'),
  pin_failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (pin_failed_attempts >= 0),
  pin_locked_until TEXT CHECK (pin_locked_until IS NULL OR pin_locked_until GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9]*Z'),
  last_login_at TEXT CHECK (last_login_at IS NULL OR last_login_at GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9]*Z'),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9]*Z'),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9]*Z'),
  created_by INTEGER REFERENCES users (id) ON DELETE RESTRICT
) STRICT;

CREATE INDEX idx_users_role ON users (role_id);

-- Il reste toujours au moins un administrateur actif.
CREATE TRIGGER trg_users_last_admin BEFORE UPDATE OF role_id, is_active ON users
WHEN OLD.is_active = 1
  AND OLD.role_id = (SELECT r.id FROM roles r WHERE r.code = 'admin')
  AND (NEW.is_active = 0 OR NEW.role_id IS NOT OLD.role_id)
BEGIN
  SELECT RAISE(ABORT, 'LAST_ADMIN: il doit rester au moins un administrateur actif')
  WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id <> OLD.id AND u.is_active = 1 AND u.role_id = OLD.role_id);
END;

-- Journal d'audit chaîné (B.4, E.4). Chaque ligne porte l'empreinte de la précédente.
-- La fonction audit_hash() est enregistrée par l'application sur sa connexion : une écriture
-- faite par un autre outil échoue, et toute altération est détectée par la vérification.
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users (id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action GLOB '[a-z]*.[a-z]*'),
  entity_type TEXT,
  entity_id INTEGER,
  details TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(details) AND json_type(details) = 'object'),
  created_at TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9]*Z'),
  prev_hash TEXT NOT NULL CHECK (length(prev_hash) = 64 AND prev_hash NOT GLOB '*[^0-9a-f]*'),
  hash TEXT NOT NULL UNIQUE CHECK (length(hash) = 64 AND hash NOT GLOB '*[^0-9a-f]*')
) STRICT;

CREATE INDEX idx_audit_log_created_at ON audit_log (created_at);
CREATE INDEX idx_audit_log_entity ON audit_log (entity_type, entity_id);
CREATE INDEX idx_audit_log_user ON audit_log (user_id);

CREATE TRIGGER trg_audit_log_chain BEFORE INSERT ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'AUDIT_CHAIN: empreinte précédente invalide')
  WHERE NEW.prev_hash IS NOT coalesce(
    (SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1),
    '0000000000000000000000000000000000000000000000000000000000000000'
  );
  SELECT RAISE(ABORT, 'AUDIT_CHAIN: empreinte invalide')
  WHERE NEW.hash IS NOT audit_hash(
    NEW.prev_hash, NEW.user_id, NEW.action, NEW.entity_type, NEW.entity_id, NEW.details, NEW.created_at
  );
END;

CREATE TRIGGER trg_audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE: audit_log');
END;

CREATE TRIGGER trg_audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE: audit_log');
END;

CREATE TABLE settings (
  key TEXT PRIMARY KEY CHECK (key GLOB '[a-z]*.[a-z]*'),
  value TEXT NOT NULL CHECK (json_valid(value)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9]*Z'),
  updated_by INTEGER REFERENCES users (id) ON DELETE RESTRICT
) STRICT, WITHOUT ROWID;

CREATE TRIGGER trg_settings_no_delete BEFORE DELETE ON settings
BEGIN
  SELECT RAISE(ABORT, 'NO_DELETE: settings s''archive, ne se supprime pas');
END;

CREATE TABLE backup_log (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('auto', 'manual', 'pre_migration')),
  path TEXT NOT NULL CHECK (length(path) > 0),
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  checksum TEXT NOT NULL CHECK (length(checksum) = 64),
  status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9]*Z')
) STRICT;

CREATE TRIGGER trg_backup_log_no_update BEFORE UPDATE ON backup_log
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE: backup_log');
END;

CREATE TRIGGER trg_backup_log_no_delete BEFORE DELETE ON backup_log
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE: backup_log');
END;

CREATE TRIGGER trg_users_no_delete BEFORE DELETE ON users
BEGIN
  SELECT RAISE(ABORT, 'NO_DELETE: users s''archive, ne se supprime pas');
END;
CREATE TRIGGER trg_roles_no_delete BEFORE DELETE ON roles
BEGIN
  SELECT RAISE(ABORT, 'NO_DELETE: roles s''archive, ne se supprime pas');
END;
CREATE TRIGGER trg_permissions_no_delete BEFORE DELETE ON permissions
BEGIN
  SELECT RAISE(ABORT, 'NO_DELETE: permissions s''archive, ne se supprime pas');
END;
