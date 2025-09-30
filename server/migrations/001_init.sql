CREATE TABLE IF NOT EXISTS kv_store (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  id BIGSERIAL PRIMARY KEY,
  timestamp BIGINT NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
DECLARE
  sessions_owner NAME;
BEGIN
  SELECT pg_get_userbyid(c.relowner)
    INTO sessions_owner
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname = 'sessions'
     AND c.relkind = 'r';

  IF sessions_owner IS NULL THEN
    RAISE NOTICE 'Überspringe Index-Erstellung für "sessions", Tabelle nicht gefunden.';
    RETURN;
  END IF;

  IF sessions_owner = CURRENT_USER THEN
    BEGIN
      EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS sessions_timestamp_idx ON public.sessions (timestamp)';
    EXCEPTION
      WHEN insufficient_privilege THEN
        RAISE NOTICE 'Überspringe Index-Erstellung für "sessions" wegen fehlender Berechtigungen.';
    END;
  ELSE
    RAISE NOTICE 'Überspringe Index-Erstellung für "sessions", Besitzer ist % (aktueller Nutzer: %).', sessions_owner, CURRENT_USER;
  END IF;
END;
$$;
