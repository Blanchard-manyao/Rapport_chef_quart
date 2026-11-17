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

ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_login_attempts ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION record_admin_login_failure(p_login_key TEXT)
RETURNS VOID
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO admin_login_attempts (login_key, failed_count, locked_until)
  VALUES (p_login_key, 1, NULL)
  ON CONFLICT (login_key) DO UPDATE SET
    failed_count = CASE
      WHEN admin_login_attempts.locked_until > now() THEN admin_login_attempts.failed_count
      ELSE admin_login_attempts.failed_count + 1
    END,
    locked_until = CASE
      WHEN admin_login_attempts.locked_until > now() THEN admin_login_attempts.locked_until
      WHEN admin_login_attempts.failed_count + 1 >= 5 THEN now() + interval '15 minutes'
      ELSE NULL
    END;
$$;

REVOKE EXECUTE ON FUNCTION record_admin_login_failure(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION record_admin_login_failure(TEXT) TO service_role;
