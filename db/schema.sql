PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS couple_accounts (
  id TEXT PRIMARY KEY,
  primary_email TEXT NOT NULL,
  secondary_email TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT 'Nha cua hai dua',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS couple_members (
  id TEXT PRIMARY KEY,
  couple_id TEXT NOT NULL REFERENCES couple_accounts(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  email_normalized TEXT NOT NULL UNIQUE,
  display_name TEXT,
  password_hash TEXT NOT NULL,
  requires_password_change INTEGER NOT NULL DEFAULT 1 CHECK (requires_password_change IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  password_issued_at TEXT NOT NULL,
  password_changed_at TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES couple_members(id) ON DELETE CASCADE,
  couple_id TEXT NOT NULL REFERENCES couple_accounts(id) ON DELETE CASCADE,
  jwt_id TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS couple_snapshots (
  id TEXT PRIMARY KEY,
  couple_id TEXT NOT NULL UNIQUE REFERENCES couple_accounts(id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  updated_by_member_id TEXT REFERENCES couple_members(id),
  content_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_content (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
  content_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS media_assets (
  id TEXT PRIMARY KEY,
  couple_id TEXT NOT NULL REFERENCES couple_accounts(id) ON DELETE CASCADE,
  uploaded_by_member_id TEXT NOT NULL REFERENCES couple_members(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'audio')),
  storage_key TEXT NOT NULL,
  public_url TEXT NOT NULL,
  content_type TEXT NOT NULL,
  filename TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS email_jobs (
  id TEXT PRIMARY KEY,
  member_id TEXT REFERENCES couple_members(id) ON DELETE SET NULL,
  couple_id TEXT REFERENCES couple_accounts(id) ON DELETE SET NULL,
  recipient_email TEXT NOT NULL,
  template TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  member_id TEXT REFERENCES couple_members(id) ON DELETE SET NULL,
  couple_id TEXT REFERENCES couple_accounts(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_couple_members_couple_id ON couple_members(couple_id);
CREATE INDEX IF NOT EXISTS idx_couple_accounts_primary_email ON couple_accounts(primary_email);
CREATE INDEX IF NOT EXISTS idx_couple_accounts_secondary_email ON couple_accounts(secondary_email);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_member_id ON refresh_tokens(member_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_couple_id ON refresh_tokens(couple_id);
CREATE INDEX IF NOT EXISTS idx_media_assets_couple_id ON media_assets(couple_id);
CREATE INDEX IF NOT EXISTS idx_media_assets_uploaded_by_member_id ON media_assets(uploaded_by_member_id);
CREATE INDEX IF NOT EXISTS idx_email_jobs_status ON email_jobs(status);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action_created_at ON audit_logs(action, created_at);
