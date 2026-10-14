CREATE TABLE browser_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_browser_sessions_user ON browser_sessions(user_id);
ALTER TABLE oauth_embed_handoffs ADD COLUMN browser_session_hash TEXT;
ALTER TABLE oauth_embed_handoffs ADD COLUMN denied INTEGER NOT NULL DEFAULT 0 CHECK(denied IN (0,1));
ALTER TABLE sessions ADD COLUMN browser_session_hash TEXT;
CREATE INDEX idx_sessions_browser ON sessions(browser_session_hash);
