CREATE TABLE IF NOT EXISTS lobbies (
  id SERIAL PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  join_code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS lobbies_join_code_unique_idx
  ON lobbies (join_code);

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
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (lobby_id, user_id)
);

CREATE INDEX IF NOT EXISTS lobby_members_user_idx
  ON lobby_members (user_id);

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

ALTER TABLE kv_store DROP CONSTRAINT IF EXISTS kv_store_pkey;
ALTER TABLE kv_store
  ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS lobby_id INTEGER REFERENCES lobbies(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS kv_store_key_scope_unique_idx
  ON kv_store (key, owner_id, lobby_id);

CREATE INDEX IF NOT EXISTS kv_store_owner_idx
  ON kv_store (owner_id);

CREATE INDEX IF NOT EXISTS kv_store_lobby_idx
  ON kv_store (lobby_id);

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS lobby_id INTEGER REFERENCES lobbies(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS sessions_owner_idx
  ON sessions (owner_id);

CREATE INDEX IF NOT EXISTS sessions_lobby_idx
  ON sessions (lobby_id);

ALTER TABLE session_timelines
  ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS lobby_id INTEGER REFERENCES lobbies(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS session_timelines_owner_idx
  ON session_timelines (owner_id);

CREATE INDEX IF NOT EXISTS session_timelines_lobby_idx
  ON session_timelines (lobby_id);

ALTER TABLE session_metrics
  ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS lobby_id INTEGER REFERENCES lobbies(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS session_metrics_owner_idx
  ON session_metrics (owner_id);

CREATE INDEX IF NOT EXISTS session_metrics_lobby_idx
  ON session_metrics (lobby_id);
