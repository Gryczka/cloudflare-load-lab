CREATE TABLE IF NOT EXISTS targets (
  id TEXT PRIMARY KEY,
  origin TEXT NOT NULL UNIQUE,
  challenge TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  verified_at TEXT,
  expires_at TEXT
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  target_origin TEXT NOT NULL,
  status TEXT NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 0,
  regions_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  summary_json TEXT,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_runs_created_at ON runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_demo_created_at ON runs(is_demo, created_at DESC);
