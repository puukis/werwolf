CREATE TABLE IF NOT EXISTS lobbies (
  id SERIAL PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  join_code TEXT NOT NULL,
  is_personal BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS lobbies_join_code_unique_idx
  ON lobbies (join_code);

CREATE UNIQUE INDEX IF NOT EXISTS lobbies_owner_personal_unique_idx
  ON lobbies (owner_id)
  WHERE is_personal;

CREATE OR REPLACE FUNCTION set_lobbies_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS lobbies_set_updated_at ON lobbies;
CREATE TRIGGER lobbies_set_updated_at
  BEFORE UPDATE ON lobbies
  FOR EACH ROW
  EXECUTE FUNCTION set_lobbies_updated_at();

CREATE TABLE IF NOT EXISTS lobby_members (
  lobby_id INTEGER NOT NULL REFERENCES lobbies(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (lobby_id, user_id),
  CONSTRAINT lobby_members_role_check CHECK (role IN ('owner', 'admin', 'member'))
);

CREATE OR REPLACE FUNCTION set_lobby_members_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS lobby_members_set_updated_at ON lobby_members;
CREATE TRIGGER lobby_members_set_updated_at
  BEFORE UPDATE ON lobby_members
  FOR EACH ROW
  EXECUTE FUNCTION set_lobby_members_updated_at();

CREATE UNIQUE INDEX IF NOT EXISTS lobby_members_owner_unique_idx
  ON lobby_members (lobby_id)
  WHERE role = 'owner';

CREATE INDEX IF NOT EXISTS lobby_members_user_id_idx
  ON lobby_members (user_id);

CREATE INDEX IF NOT EXISTS lobby_members_role_idx
  ON lobby_members (role);

ALTER TABLE kv_store DROP CONSTRAINT IF EXISTS kv_store_pkey;
ALTER TABLE kv_store
  ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS lobby_id INTEGER REFERENCES lobbies(id) ON DELETE CASCADE;

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS lobby_id INTEGER REFERENCES lobbies(id) ON DELETE CASCADE;

ALTER TABLE session_timelines DROP CONSTRAINT IF EXISTS session_timelines_pkey;
ALTER TABLE session_timelines
  ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS lobby_id INTEGER REFERENCES lobbies(id) ON DELETE CASCADE;

ALTER TABLE session_metrics DROP CONSTRAINT IF EXISTS session_metrics_pkey;
ALTER TABLE session_metrics
  ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS lobby_id INTEGER REFERENCES lobbies(id) ON DELETE CASCADE;

DELETE FROM kv_store WHERE owner_id IS NULL OR lobby_id IS NULL;
DELETE FROM sessions WHERE owner_id IS NULL OR lobby_id IS NULL;
DELETE FROM session_timelines WHERE owner_id IS NULL OR lobby_id IS NULL;
DELETE FROM session_metrics WHERE owner_id IS NULL OR lobby_id IS NULL;

ALTER TABLE kv_store
  ALTER COLUMN owner_id SET NOT NULL,
  ALTER COLUMN lobby_id SET NOT NULL;
ALTER TABLE kv_store
  ADD CONSTRAINT kv_store_pkey PRIMARY KEY (lobby_id, key);
CREATE INDEX IF NOT EXISTS kv_store_owner_idx
  ON kv_store (owner_id);
CREATE INDEX IF NOT EXISTS kv_store_lobby_idx
  ON kv_store (lobby_id);

ALTER TABLE sessions
  ALTER COLUMN owner_id SET NOT NULL,
  ALTER COLUMN lobby_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS sessions_owner_idx
  ON sessions (owner_id);
CREATE INDEX IF NOT EXISTS sessions_lobby_idx
  ON sessions (lobby_id);
DROP INDEX IF EXISTS sessions_timestamp_idx;
CREATE UNIQUE INDEX IF NOT EXISTS sessions_lobby_timestamp_unique_idx
  ON sessions (lobby_id, timestamp);

ALTER TABLE session_timelines
  ALTER COLUMN owner_id SET NOT NULL,
  ALTER COLUMN lobby_id SET NOT NULL;
ALTER TABLE session_timelines
  ADD CONSTRAINT session_timelines_pkey PRIMARY KEY (lobby_id, session_timestamp);
CREATE INDEX IF NOT EXISTS session_timelines_owner_idx
  ON session_timelines (owner_id);

ALTER TABLE session_metrics
  ALTER COLUMN owner_id SET NOT NULL,
  ALTER COLUMN lobby_id SET NOT NULL;
ALTER TABLE session_metrics
  ADD CONSTRAINT session_metrics_pkey PRIMARY KEY (lobby_id, session_timestamp);
CREATE INDEX IF NOT EXISTS session_metrics_owner_idx
  ON session_metrics (owner_id);
CREATE INDEX IF NOT EXISTS session_metrics_lobby_idx
  ON session_metrics (lobby_id);
