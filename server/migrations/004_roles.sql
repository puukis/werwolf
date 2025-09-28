CREATE TABLE IF NOT EXISTS role_catalog (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'role',
  faction TEXT,
  description TEXT,
  night_order INTEGER,
  night_prompt TEXT,
  night_action TEXT,
  limits JSONB NOT NULL DEFAULT '{}'::jsonb,
  ability_script TEXT,
  hooks JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT role_catalog_kind_check CHECK (kind IN ('role', 'ability'))
);

CREATE UNIQUE INDEX IF NOT EXISTS role_catalog_name_unique_idx
  ON role_catalog ((LOWER(name)));

CREATE OR REPLACE FUNCTION set_role_catalog_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS role_catalog_set_updated_at ON role_catalog;
CREATE TRIGGER role_catalog_set_updated_at
  BEFORE UPDATE ON role_catalog
  FOR EACH ROW
  EXECUTE FUNCTION set_role_catalog_updated_at();
