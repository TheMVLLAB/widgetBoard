CREATE TABLE oauth_embed_handoffs (
  id_hash TEXT PRIMARY KEY,
  verifier_hash TEXT NOT NULL,
  widget_id TEXT,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
ALTER TABLE oauth_states ADD COLUMN handoff_id TEXT;
