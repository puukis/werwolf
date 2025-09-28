const express = require('express');
const runMigrations = require('./migrate');
const { query } = require('./db');

const app = express();
app.use(express.json({ limit: '2mb' }));

function normalizeTheme(theme) {
  if (typeof theme !== 'string') {
    return null;
  }
  const trimmed = theme.trim().toLowerCase();
  if (trimmed === 'dark' || trimmed === 'light') {
    return trimmed;
  }
  return null;
}

async function getSetting(key) {
  const result = await query('SELECT value FROM kv_store WHERE key = $1', [key]);
  if (result.rowCount === 0) {
    return null;
  }
  return result.rows[0].value;
}

async function setSetting(key, value) {
  await query(
    `INSERT INTO kv_store (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, value]
  );
}

async function removeSetting(key) {
  await query('DELETE FROM kv_store WHERE key = $1', [key]);
}

app.get('/api/theme', async (req, res) => {
  try {
    const value = await getSetting('theme');
    res.json({ theme: typeof value === 'string' ? value : null });
  } catch (error) {
    res.status(500).json({ error: 'Theme konnte nicht geladen werden.' });
  }
});

app.put('/api/theme', async (req, res) => {
  try {
    const theme = normalizeTheme(req.body?.theme);
    if (!theme) {
      return res.status(400).json({ error: 'Ungültiges Theme.' });
    }
    await setSetting('theme', theme);
    res.json({ theme });
  } catch (error) {
    res.status(500).json({ error: 'Theme konnte nicht gespeichert werden.' });
  }
});

app.get('/api/saved-names', async (req, res) => {
  try {
    const value = await getSetting('werwolfSavedNames');
    res.json({ names: Array.isArray(value) ? value : [] });
  } catch (error) {
    res.status(500).json({ error: 'Gespeicherte Namen konnten nicht geladen werden.' });
  }
});

app.put('/api/saved-names', async (req, res) => {
  try {
    const names = Array.isArray(req.body?.names)
      ? req.body.names.filter((name) => typeof name === 'string' && name.trim().length > 0)
      : [];
    await setSetting('werwolfSavedNames', names);
    res.json({ names });
  } catch (error) {
    res.status(500).json({ error: 'Gespeicherte Namen konnten nicht abgelegt werden.' });
  }
});

app.get('/api/role-presets', async (req, res) => {
  try {
    const value = await getSetting('werwolfSavedRoles');
    res.json({ roles: Array.isArray(value) ? value : [] });
  } catch (error) {
    res.status(500).json({ error: 'Gespeicherte Rollen konnten nicht geladen werden.' });
  }
});

app.put('/api/role-presets', async (req, res) => {
  try {
    const roles = Array.isArray(req.body?.roles)
      ? req.body.roles
          .filter((role) => role && typeof role.name === 'string' && role.name.trim().length > 0)
          .map((role) => ({
            name: role.name.trim(),
            quantity: Number.isFinite(role.quantity) ? Math.max(0, Math.round(role.quantity)) : 0,
          }))
      : [];
    await setSetting('werwolfSavedRoles', roles);
    res.json({ roles });
  } catch (error) {
    res.status(500).json({ error: 'Gespeicherte Rollen konnten nicht abgelegt werden.' });
  }
});

app.get('/api/storage/:key', async (req, res) => {
  try {
    const key = req.params.key;
    const value = await getSetting(key);
    res.json({ key, value: value ?? null });
  } catch (error) {
    res.status(500).json({ error: 'Persistenter Wert konnte nicht geladen werden.' });
  }
});

app.put('/api/storage/:key', async (req, res) => {
  try {
    const key = req.params.key;
    const { value = null } = req.body || {};
    await setSetting(key, value);
    res.json({ key, value });
  } catch (error) {
    res.status(500).json({ error: 'Persistenter Wert konnte nicht gespeichert werden.' });
  }
});

app.delete('/api/storage/:key', async (req, res) => {
  try {
    const key = req.params.key;
    await removeSetting(key);
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ error: 'Persistenter Wert konnte nicht entfernt werden.' });
  }
});

async function listSessions() {
  const result = await query(
    `SELECT timestamp, data
       FROM sessions
      ORDER BY timestamp DESC
      LIMIT 20`
  );
  return result.rows.map((row) => ({ ...row.data, timestamp: Number(row.timestamp) }));
}

async function upsertSession(session) {
  await query(
    `INSERT INTO sessions (timestamp, data, created_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (timestamp)
     DO UPDATE SET data = EXCLUDED.data`,
    [session.timestamp, session]
  );

  await query(
    `DELETE FROM sessions
      WHERE timestamp NOT IN (
        SELECT timestamp FROM sessions ORDER BY timestamp DESC LIMIT 20
      )`
  );
}

app.get('/api/sessions', async (req, res) => {
  try {
    const sessions = await listSessions();
    res.json({ sessions });
  } catch (error) {
    res.status(500).json({ error: 'Sessions konnten nicht geladen werden.' });
  }
});

app.post('/api/sessions', async (req, res) => {
  try {
    const session = req.body?.session;
    if (!session || typeof session !== 'object') {
      return res.status(400).json({ error: 'Ungültige Session.' });
    }
    const timestamp = Number(session.timestamp || Date.now());
    const normalized = { ...session, timestamp };
    await upsertSession(normalized);
    const sessions = await listSessions();
    res.status(201).json({ session: normalized, sessions });
  } catch (error) {
    res.status(500).json({ error: 'Session konnte nicht gespeichert werden.' });
  }
});

app.delete('/api/sessions/:timestamp', async (req, res) => {
  try {
    const timestamp = Number(req.params.timestamp);
    if (!Number.isFinite(timestamp)) {
      return res.status(400).json({ error: 'Ungültiger Zeitstempel.' });
    }
    await query('DELETE FROM sessions WHERE timestamp = $1', [timestamp]);
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ error: 'Session konnte nicht gelöscht werden.' });
  }
});

async function start() {
  await runMigrations();
  const port = Number(process.env.PORT) || 3001;
  app.listen(port, () => {
    console.log(`Werwolf Backend lauscht auf Port ${port}`);
  });
}

if (require.main === module) {
  start().catch((error) => {
    console.error('Serverstart fehlgeschlagen:', error);
    process.exit(1);
  });
}

module.exports = app;
