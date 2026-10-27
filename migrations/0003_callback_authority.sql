-- Only the trusted coordinator registers hashed callback authority, before launch.
CREATE TABLE IF NOT EXISTS run_callback_authority (
  run_id TEXT NOT NULL,
  assignment_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (run_id, assignment_id)
);
CREATE INDEX IF NOT EXISTS callback_authority_expiry ON run_callback_authority(expires_at);
