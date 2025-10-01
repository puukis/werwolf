ALTER TABLE session_metrics
  ADD COLUMN IF NOT EXISTS winner_faction TEXT,
  ADD COLUMN IF NOT EXISTS winning_players JSONB;

CREATE INDEX IF NOT EXISTS session_metrics_winner_faction_idx
  ON session_metrics (winner_faction);

CREATE INDEX IF NOT EXISTS session_metrics_winning_players_idx
  ON session_metrics USING GIN (winning_players jsonb_path_ops);

UPDATE session_metrics
   SET winner_faction = CASE
     WHEN winner ILIKE 'Werwölfe%' THEN 'werwolf'
     WHEN winner ILIKE 'Dorfbewohner%' THEN 'village'
     WHEN winner ILIKE 'Die Liebenden%' THEN 'lovers'
     WHEN winner ILIKE 'Der Henker%' THEN 'henker'
     WHEN winner ILIKE 'Der Friedenstifter%' THEN 'friedenstifter'
     ELSE winner_faction
   END
 WHERE winner IS NOT NULL
   AND winner <> ''
   AND winner_faction IS NULL;

UPDATE session_metrics
   SET winning_players = '[]'::jsonb
 WHERE winning_players IS NULL;
