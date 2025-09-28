const express = require('express');
const crypto = require('crypto');
const runMigrations = require('./migrate');
const { query } = require('./db');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(cookieParserMiddleware);
app.use(loadUserFromSession);

const SESSION_COOKIE_NAME = 'werwolf_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const isProduction = process.env.NODE_ENV === 'production';
const baseCookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: isProduction,
  path: '/',
};

function parseCookies(headerValue) {
  if (!headerValue || typeof headerValue !== 'string') {
    return {};
  }

  return headerValue
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .reduce((acc, part) => {
      const separator = part.indexOf('=');
      if (separator === -1) {
        return acc;
      }

      const key = decodeURIComponent(part.slice(0, separator).trim());
      const value = decodeURIComponent(part.slice(separator + 1).trim());
      if (key.length > 0) {
        acc[key] = value;
      }
      return acc;
    }, {});
}

function cookieParserMiddleware(req, res, next) {
  req.cookies = parseCookies(req.headers?.cookie || '');
  next();
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function scryptAsync(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (error, derivedKey) => {
      if (error) {
        reject(error);
      } else {
        resolve(derivedKey);
      }
    });
  });
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = await scryptAsync(password, salt);
  return `${salt}:${derivedKey.toString('hex')}`;
}

async function verifyPassword(password, storedHash) {
  if (typeof storedHash !== 'string' || storedHash.indexOf(':') === -1) {
    return false;
  }
  const [salt, key] = storedHash.split(':');
  if (!salt || !key) {
    return false;
  }
  const derivedKey = await scryptAsync(password, salt);
  const storedKey = Buffer.from(key, 'hex');
  if (storedKey.length !== derivedKey.length) {
    return false;
  }
  return crypto.timingSafeEqual(storedKey, derivedKey);
}

function normalizeEmail(email) {
  if (typeof email !== 'string') {
    return null;
  }
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return null;
  }
  return normalized;
}

function normalizeDisplayName(name) {
  if (typeof name !== 'string') {
    return null;
  }
  const normalized = name.replace(/\s+/g, ' ').trim();
  if (normalized.length < 2) {
    return null;
  }
  return normalized;
}

function formatUser(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    isAdmin: row.is_admin,
  };
}

async function cleanupExpiredSessions() {
  await query('DELETE FROM user_sessions WHERE expires_at <= NOW()');
}

async function createSession(userId) {
  await cleanupExpiredSessions();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(token);
    try {
      await query(
        'INSERT INTO user_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
        [tokenHash, userId, expiresAt]
      );
      return { token, expiresAt };
    } catch (error) {
      if (error?.code === '23505') {
        continue;
      }
      throw error;
    }
  }

  throw new Error('Sitzung konnte nicht gespeichert werden.');
}

async function destroySessionByToken(token) {
  if (!token) {
    return;
  }
  const tokenHash = hashToken(token);
  await query('DELETE FROM user_sessions WHERE token_hash = $1', [tokenHash]);
}

async function loadSession(token) {
  if (!token) {
    return null;
  }
  const tokenHash = hashToken(token);
  const result = await query(
    `SELECT s.token_hash, s.expires_at, u.id, u.email, u.display_name, u.is_admin
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1`,
    [tokenHash]
  );

  if (result.rowCount === 0) {
    return null;
  }

  const row = result.rows[0];
  const expiresAt = new Date(row.expires_at);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
    await query('DELETE FROM user_sessions WHERE token_hash = $1', [tokenHash]);
    return null;
  }

  return {
    tokenHash: row.token_hash,
    expiresAt,
    user: {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      isAdmin: row.is_admin,
    },
  };
}

function setSessionCookie(res, token, expiresAt) {
  res.cookie(SESSION_COOKIE_NAME, token, { ...baseCookieOptions, expires: expiresAt });
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE_NAME, { ...baseCookieOptions, expires: new Date(0) });
}

async function loadUserFromSession(req, res, next) {
  const token = req.cookies?.[SESSION_COOKIE_NAME];
  req.user = null;

  if (!token) {
    return next();
  }

  try {
    const session = await loadSession(token);
    if (!session) {
      clearSessionCookie(res);
      return next();
    }

    req.user = session.user;
    req.sessionTokenHash = session.tokenHash;
    return next();
  } catch (error) {
    return next(error);
  }
}

function requireAuthForApi(req, res, next) {
  if (req.path?.startsWith('/auth')) {
    return next();
  }
  if (!req.user) {
    return res.status(401).json({ error: 'Bitte melde dich an.' });
  }
  return next();
}

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
  const serializedValue = JSON.stringify(value ?? null);
  await query(
    `INSERT INTO kv_store (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, serializedValue]
  );
}

async function removeSetting(key) {
  await query('DELETE FROM kv_store WHERE key = $1', [key]);
}

app.get('/api/auth/me', (req, res) => {
  if (!req.user) {
    return res.json({ user: null });
  }
  return res.json({ user: { ...req.user } });
});

app.post('/api/auth/logout', async (req, res) => {
  try {
    const token = req.cookies?.[SESSION_COOKIE_NAME];
    if (token) {
      await destroySessionByToken(token);
    }
    clearSessionCookie(res);
    return res.status(204).end();
  } catch (error) {
    console.error('Abmelden fehlgeschlagen:', error);
    return res.status(500).json({ error: 'Abmelden fehlgeschlagen.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail || typeof password !== 'string' || password.length === 0) {
      return res.status(400).json({ error: 'E-Mail oder Passwort ist ungültig.' });
    }

    const result = await query(
      `SELECT id, email, display_name, is_admin, password_hash
         FROM users
        WHERE LOWER(email) = LOWER($1)
        LIMIT 1`,
      [normalizedEmail]
    );

    if (result.rowCount === 0) {
      return res.status(400).json({ error: 'E-Mail oder Passwort ist falsch.' });
    }

    const userRow = result.rows[0];
    const passwordValid = await verifyPassword(password, userRow.password_hash);
    if (!passwordValid) {
      return res.status(400).json({ error: 'E-Mail oder Passwort ist falsch.' });
    }

    const { token, expiresAt } = await createSession(userRow.id);
    setSessionCookie(res, token, expiresAt);

    return res.json({ user: formatUser(userRow) });
  } catch (error) {
    console.error('Anmeldung fehlgeschlagen:', error);
    return res.status(500).json({ error: 'Anmeldung fehlgeschlagen.' });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, displayName, adminCode, adminKey } = req.body || {};
    const normalizedEmail = normalizeEmail(email);
    const normalizedDisplayName = normalizeDisplayName(displayName);
    const providedAdminCode = (() => {
      if (typeof adminCode === 'string' && adminCode.trim().length > 0) {
        return adminCode.trim();
      }
      if (typeof adminKey === 'string' && adminKey.trim().length > 0) {
        return adminKey.trim();
      }
      return '';
    })();

    if (!normalizedEmail) {
      return res.status(400).json({ error: 'Bitte gib eine gültige E-Mail-Adresse an.' });
    }
    if (!normalizedDisplayName) {
      return res.status(400).json({ error: 'Der Anzeigename muss mindestens zwei Zeichen enthalten.' });
    }
    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'Das Passwort muss mindestens 8 Zeichen haben.' });
    }

    const existing = await query('SELECT 1 FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1', [normalizedEmail]);
    if (existing.rowCount > 0) {
      return res.status(409).json({ error: 'Diese E-Mail-Adresse wird bereits verwendet.' });
    }

    const adminCountResult = await query('SELECT COUNT(*)::int AS count FROM users WHERE is_admin = TRUE');
    const hasAdmin = Number(adminCountResult.rows[0].count || 0) > 0;
    const expectedAdminCode = (process.env.WERWOLF_ADMIN_CODE || '').trim();
    let isAdmin = false;

    if (!hasAdmin) {
      isAdmin = true;
    } else if (providedAdminCode && expectedAdminCode && providedAdminCode === expectedAdminCode) {
      isAdmin = true;
    } else if (providedAdminCode && (!expectedAdminCode || providedAdminCode !== expectedAdminCode)) {
      return res.status(403).json({ error: 'Der angegebene Admin-Code ist ungültig.' });
    }

    const passwordHash = await hashPassword(password);
    const insertResult = await query(
      `INSERT INTO users (email, password_hash, display_name, is_admin)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, display_name, is_admin`,
      [normalizedEmail, passwordHash, normalizedDisplayName, isAdmin]
    );

    const userRow = insertResult.rows[0];
    const { token, expiresAt } = await createSession(userRow.id);
    setSessionCookie(res, token, expiresAt);

    return res.status(201).json({ user: formatUser(userRow) });
  } catch (error) {
    console.error('Registrierung fehlgeschlagen:', error);
    return res.status(500).json({ error: 'Registrierung fehlgeschlagen.' });
  }
});

app.use('/api', requireAuthForApi);

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

  await pruneSessionStorage(20);
}

async function upsertSessionTimeline(session) {
  if (!session?.timeline || typeof session.timeline !== 'object') {
    return;
  }

  await query(
    `INSERT INTO session_timelines (session_timestamp, timeline, created_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (session_timestamp)
     DO UPDATE SET timeline = EXCLUDED.timeline, updated_at = NOW()`,
    [session.timestamp, session.timeline]
  );
}

async function upsertSessionMetrics(session) {
  const metadata = session?.metadata || {};
  const timeline = session?.timeline || {};
  const actions = Array.isArray(timeline.actions) ? timeline.actions : [];
  const checkpoints = Array.isArray(timeline.checkpoints) ? timeline.checkpoints : [];
  const winnerTitle = typeof metadata?.winner?.title === 'string' ? metadata.winner.title : (typeof metadata?.winner?.message === 'string' ? metadata.winner.message : null);
  const playerCount = Number.isFinite(metadata.playerCount) ? metadata.playerCount : Array.isArray(session.players) ? session.players.length : null;
  const actionCount = Number.isFinite(metadata.actionCount) ? metadata.actionCount : actions.length;
  const checkpointCount = Number.isFinite(metadata.checkpointCount) ? metadata.checkpointCount : checkpoints.length;

  let gameLengthMs = Number.isFinite(metadata.gameDurationMs) ? metadata.gameDurationMs : null;
  if (!Number.isFinite(gameLengthMs) && actions.length > 1) {
    const first = actions[0]?.timestamp;
    const last = actions[actions.length - 1]?.timestamp;
    const duration = Number(last) - Number(first);
    if (Number.isFinite(duration) && duration >= 0) {
      gameLengthMs = duration;
    }
  }

  await query(
    `INSERT INTO session_metrics (session_timestamp, winner, player_count, action_count, checkpoint_count, game_length_ms, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (session_timestamp)
     DO UPDATE SET winner = EXCLUDED.winner,
                   player_count = EXCLUDED.player_count,
                   action_count = EXCLUDED.action_count,
                   checkpoint_count = EXCLUDED.checkpoint_count,
                   game_length_ms = EXCLUDED.game_length_ms,
                   updated_at = NOW()`,
    [session.timestamp, winnerTitle, playerCount, actionCount, checkpointCount, gameLengthMs]
  );
}

async function pruneSessionStorage(limit = 20) {
  await query(
    `DELETE FROM sessions
      WHERE timestamp NOT IN (
        SELECT timestamp FROM sessions ORDER BY timestamp DESC LIMIT $1
      )`,
    [limit]
  );

  await query(
    `DELETE FROM session_timelines
      WHERE session_timestamp NOT IN (
        SELECT timestamp FROM sessions ORDER BY timestamp DESC LIMIT $1
      )`,
    [limit]
  );

  await query(
    `DELETE FROM session_metrics
      WHERE session_timestamp NOT IN (
        SELECT timestamp FROM sessions ORDER BY timestamp DESC LIMIT $1
      )`,
    [limit]
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
    await upsertSessionTimeline(normalized);
    await upsertSessionMetrics(normalized);
    const sessions = await listSessions();
    res.status(201).json({ session: normalized, sessions });
  } catch (error) {
    res.status(500).json({ error: 'Session konnte nicht gespeichert werden.' });
  }
});

app.get('/api/sessions/:timestamp/timeline', async (req, res) => {
  try {
    const timestamp = Number(req.params.timestamp);
    if (!Number.isFinite(timestamp)) {
      return res.status(400).json({ error: 'Ungültiger Zeitstempel.' });
    }
    const result = await query(
      `SELECT timeline
         FROM session_timelines
        WHERE session_timestamp = $1
        LIMIT 1`,
      [timestamp]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Keine Timeline für diese Session gefunden.' });
    }
    return res.json({ timeline: result.rows[0].timeline });
  } catch (error) {
    console.error('Timeline konnte nicht geladen werden:', error);
    return res.status(500).json({ error: 'Timeline konnte nicht geladen werden.' });
  }
});

app.delete('/api/sessions/:timestamp', async (req, res) => {
  try {
    const timestamp = Number(req.params.timestamp);
    if (!Number.isFinite(timestamp)) {
      return res.status(400).json({ error: 'Ungültiger Zeitstempel.' });
    }
    await query('DELETE FROM sessions WHERE timestamp = $1', [timestamp]);
    await query('DELETE FROM session_timelines WHERE session_timestamp = $1', [timestamp]);
    await query('DELETE FROM session_metrics WHERE session_timestamp = $1', [timestamp]);
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ error: 'Session konnte nicht gelöscht werden.' });
  }
});

app.get('/api/analytics', async (req, res) => {
  try {
    const summaryResult = await query(
      `SELECT
         COUNT(*)::int AS session_count,
         AVG(game_length_ms)::bigint AS average_game_length_ms,
         AVG(action_count)::numeric AS average_action_count,
         AVG(player_count)::numeric AS average_player_count
        FROM session_metrics`
    );
    const summaryRow = summaryResult.rows[0] || {};

    const winRateResult = await query(
      `SELECT winner, COUNT(*)::int AS count
         FROM session_metrics
        WHERE winner IS NOT NULL AND winner <> ''
        GROUP BY winner
        ORDER BY count DESC`
    );
    const totalWins = winRateResult.rows.reduce((acc, row) => acc + Number(row.count || 0), 0);
    const winRates = winRateResult.rows.map((row) => ({
      winner: row.winner,
      count: row.count,
      rate: totalWins > 0 ? Number(row.count) / totalWins : null,
    }));

    const metaResult = await query(
      `SELECT
         AVG((data->'metadata'->>'dayCount')::numeric) AS average_day_count,
         AVG((data->'metadata'->>'nightCount')::numeric) AS average_night_count
        FROM sessions
       WHERE data ? 'metadata'`
    );
    const metaRow = metaResult.rows[0] || {};

    res.json({
      summary: {
        sessionCount: Number(summaryRow.session_count || 0),
        averageGameLengthMs: summaryRow.average_game_length_ms !== null ? Number(summaryRow.average_game_length_ms) : null,
        averageActionCount: summaryRow.average_action_count !== null ? Number(summaryRow.average_action_count) : null,
        averagePlayerCount: summaryRow.average_player_count !== null ? Number(summaryRow.average_player_count) : null,
      },
      winRates,
      meta: {
        averageDayCount: metaRow.average_day_count !== null ? Number(metaRow.average_day_count) : null,
        averageNightCount: metaRow.average_night_count !== null ? Number(metaRow.average_night_count) : null,
      },
    });
  } catch (error) {
    console.error('Analytics konnten nicht geladen werden:', error);
    res.status(500).json({ error: 'Analytics konnten nicht geladen werden.' });
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
