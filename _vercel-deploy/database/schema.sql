CREATE TABLE IF NOT EXISTS reports (
  report_id TEXT PRIMARY KEY,
  report_date DATE NOT NULL,
  quart TEXT NOT NULL,
  equipe TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reports_report_date_idx ON reports (report_date DESC);

CREATE TABLE IF NOT EXISTS admin_login_attempts (
  login_key TEXT PRIMARY KEY,
  failed_count INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ
);
