CREATE TABLE IF NOT EXISTS session_timelines (
  session_timestamp BIGINT PRIMARY KEY,
  timeline JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION set_session_timelines_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS session_timelines_set_updated_at ON session_timelines;
CREATE TRIGGER session_timelines_set_updated_at
  BEFORE UPDATE ON session_timelines
  FOR EACH ROW
  EXECUTE FUNCTION set_session_timelines_updated_at();

CREATE TABLE IF NOT EXISTS session_metrics (
  session_timestamp BIGINT PRIMARY KEY,
  winner TEXT,
  player_count INTEGER,
  action_count INTEGER,
  checkpoint_count INTEGER,
  game_length_ms BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION set_session_metrics_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS session_metrics_set_updated_at ON session_metrics;
CREATE TRIGGER session_metrics_set_updated_at
  BEFORE UPDATE ON session_metrics
  FOR EACH ROW
  EXECUTE FUNCTION set_session_metrics_updated_at();

CREATE INDEX IF NOT EXISTS session_metrics_winner_idx
  ON session_metrics (winner);
