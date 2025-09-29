const express = require('express');
const crypto = require('crypto');
const runMigrations = require('./migrate');
const { query } = require('./db');

const SESSION_COOKIE_NAME = 'werwolf_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const isProduction = process.env.NODE_ENV === 'production';
const baseCookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: isProduction,
  path: '/',
};

const LOBBY_HEADER_NAME = 'x-werwolf-lobby';
const LOBBY_ADMIN_ROLES = new Set(['owner', 'admin']);

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(cookieParserMiddleware);
app.use(loadUserFromSession);

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

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function parseLobbyId(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function normalizeLobbyName(name) {
  if (typeof name !== 'string') {
    return null;
  }
  const normalized = name.replace(/\s+/g, ' ').trim();
  if (normalized.length < 2) {
    return null;
  }
  if (normalized.length > 120) {
    return normalized.slice(0, 120);
  }
  return normalized;
}

async function generateUniqueJoinCode() {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = crypto.randomBytes(4).toString('hex');
    const existing = await query('SELECT 1 FROM lobbies WHERE join_code = $1 LIMIT 1', [candidate]);
    if (existing.rowCount === 0) {
      return candidate;
    }
  }
  throw new Error('Konnte keinen eindeutigen Lobby-Code erzeugen.');
}

async function createLobbyForUser(userId, name) {
  const normalizedName = normalizeLobbyName(name) || 'Neue Lobby';
  const joinCode = await generateUniqueJoinCode();
  const result = await query(
    `INSERT INTO lobbies (owner_id, name, join_code)
     VALUES ($1, $2, $3)
     RETURNING id, name, join_code, owner_id`,
    [userId, normalizedName, joinCode]
  );

  const lobby = result.rows[0];
  await query(
    `INSERT INTO lobby_members (lobby_id, user_id, role)
     VALUES ($1, $2, 'owner')
     ON CONFLICT (lobby_id, user_id)
     DO UPDATE SET role = EXCLUDED.role, updated_at = NOW()`,
    [lobby.id, userId]
  );

  return {
    id: lobby.id,
    name: lobby.name,
    joinCode: lobby.join_code,
    role: 'owner',
    ownerId: lobby.owner_id,
  };
}

async function ensureDefaultLobbyForUser(userId) {
  const existing = await query('SELECT 1 FROM lobby_members WHERE user_id = $1 LIMIT 1', [userId]);
  if (existing.rowCount > 0) {
    return null;
  }
  return createLobbyForUser(userId, 'Standard-Lobby');
}

async function listLobbiesForUser(userId) {
  await ensureDefaultLobbyForUser(userId);
  const result = await query(
    `SELECT l.id, l.name, l.join_code, l.owner_id, lm.role
       FROM lobby_members lm
       JOIN lobbies l ON l.id = lm.lobby_id
      WHERE lm.user_id = $1
      ORDER BY l.created_at ASC, l.id ASC`,
    [userId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    role: row.role,
    joinCode: LOBBY_ADMIN_ROLES.has(row.role) ? row.join_code : null,
    ownerId: row.owner_id,
  }));
}

function readLobbyIdFromRequest(req) {
  const headerValue = req.headers?.[LOBBY_HEADER_NAME];
  const queryValue = req.query?.lobbyId;
  const bodyValue = req.body?.lobbyId;
  return parseLobbyId(headerValue ?? queryValue ?? bodyValue);
}

async function loadLobbyMembership(lobbyId, userId) {
  if (!Number.isFinite(lobbyId) || lobbyId <= 0) {
    throw createHttpError(400, 'Ungültige Lobby.');
  }
  const result = await query(
    `SELECT l.id, l.name, l.join_code, l.owner_id, lm.role
       FROM lobby_members lm
       JOIN lobbies l ON l.id = lm.lobby_id
      WHERE lm.lobby_id = $1 AND lm.user_id = $2
      LIMIT 1`,
    [lobbyId, userId]
  );

  if (result.rowCount === 0) {
    throw createHttpError(403, 'Kein Zugriff auf diese Lobby.');
  }

  const membership = result.rows[0];
  return {
    lobbyId: membership.id,
    role: membership.role,
    isAdmin: LOBBY_ADMIN_ROLES.has(membership.role),
    lobby: {
      id: membership.id,
      name: membership.name,
      joinCode: membership.join_code,
      ownerId: membership.owner_id,
    },
  };
}

async function ensureLobbyContext(req, { requireAdmin = false } = {}) {
  const lobbyId = readLobbyIdFromRequest(req);
  if (!lobbyId) {
    throw createHttpError(400, 'Bitte wähle eine Lobby aus.');
  }
  const membership = await loadLobbyMembership(lobbyId, req.user.id);
  if (requireAdmin && !membership.isAdmin) {
    throw createHttpError(403, 'Du benötigst Admin-Rechte für diese Lobby.');
  }
  return membership;
}

function respondWithError(res, error, fallbackMessage) {
  if (error?.status) {
    return res.status(error.status).json({ error: error.message });
  }
  console.error(fallbackMessage, error);
  return res.status(500).json({ error: fallbackMessage });
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

function normalizeScope(scope = {}) {
  const ownerId = Number.isInteger(scope.ownerId) ? scope.ownerId : null;
  const lobbyId = Number.isInteger(scope.lobbyId) ? scope.lobbyId : null;
  if (ownerId === null && lobbyId === null) {
    throw new Error('Ungültiger Setting-Kontext.');
  }
  return { ownerId, lobbyId };
}

async function getSetting(key, scope) {
  const { ownerId, lobbyId } = normalizeScope(scope);
  const result = await query(
    `SELECT value
       FROM kv_store
      WHERE key = $1
        AND owner_id IS NOT DISTINCT FROM $2
        AND lobby_id IS NOT DISTINCT FROM $3
      LIMIT 1`,
    [key, ownerId, lobbyId]
  );
  if (result.rowCount === 0) {
    return null;
  }
  return result.rows[0].value;
}

async function setSetting(key, value, scope) {
  const { ownerId, lobbyId } = normalizeScope(scope);
  const serializedValue = JSON.stringify(value ?? null);
  await query(
    `INSERT INTO kv_store (key, value, owner_id, lobby_id, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (key, owner_id, lobby_id)
     DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, serializedValue, ownerId, lobbyId]
  );
}

async function removeSetting(key, scope) {
  const { ownerId, lobbyId } = normalizeScope(scope);
  await query(
    `DELETE FROM kv_store
      WHERE key = $1
        AND owner_id IS NOT DISTINCT FROM $2
        AND lobby_id IS NOT DISTINCT FROM $3`,
    [key, ownerId, lobbyId]
  );
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
    await ensureDefaultLobbyForUser(userRow.id);

    return res.status(201).json({ user: formatUser(userRow) });
  } catch (error) {
    console.error('Registrierung fehlgeschlagen:', error);
    return res.status(500).json({ error: 'Registrierung fehlgeschlagen.' });
  }
});

app.use('/api', requireAuthForApi);

app.get('/api/lobbies', async (req, res) => {
  try {
    const lobbies = await listLobbiesForUser(req.user.id);
    res.json({ lobbies });
  } catch (error) {
    respondWithError(res, error, 'Lobbys konnten nicht geladen werden.');
  }
});

app.post('/api/lobbies', async (req, res) => {
  try {
    const lobbyName = normalizeLobbyName(req.body?.name) || 'Neue Lobby';
    const lobby = await createLobbyForUser(req.user.id, lobbyName);
    res.status(201).json({ lobby });
  } catch (error) {
    respondWithError(res, error, 'Lobby konnte nicht erstellt werden.');
  }
});

app.post('/api/lobbies/join', async (req, res) => {
  try {
    const joinCode = typeof req.body?.joinCode === 'string' ? req.body.joinCode.trim() : '';
    if (!joinCode) {
      return res.status(400).json({ error: 'Bitte gib einen gültigen Lobby-Code ein.' });
    }
    const lobbyResult = await query(
      'SELECT id, name, join_code, owner_id FROM lobbies WHERE join_code = $1 LIMIT 1',
      [joinCode]
    );
    if (lobbyResult.rowCount === 0) {
      return res.status(404).json({ error: 'Es wurde keine Lobby mit diesem Code gefunden.' });
    }
    const lobbyRow = lobbyResult.rows[0];
    await query(
      `INSERT INTO lobby_members (lobby_id, user_id, role)
       VALUES ($1, $2, 'admin')
       ON CONFLICT (lobby_id, user_id)
       DO UPDATE SET role = EXCLUDED.role, updated_at = NOW()`,
      [lobbyRow.id, req.user.id]
    );
    const lobby = {
      id: lobbyRow.id,
      name: lobbyRow.name,
      joinCode: lobbyRow.join_code,
      role: 'admin',
      ownerId: lobbyRow.owner_id,
    };
    res.status(200).json({ lobby });
  } catch (error) {
    respondWithError(res, error, 'Beitritt zur Lobby fehlgeschlagen.');
  }
});

app.put('/api/lobbies/:id', async (req, res) => {
  try {
    const lobbyId = Number(req.params.id);
    if (!Number.isFinite(lobbyId)) {
      return res.status(400).json({ error: 'Ungültige Lobby-ID.' });
    }
    const membership = await loadLobbyMembership(lobbyId, req.user.id);
    if (!membership.isAdmin) {
      throw createHttpError(403, 'Nur Admins können die Lobby umbenennen.');
    }
    const name = normalizeLobbyName(req.body?.name);
    if (!name) {
      return res.status(400).json({ error: 'Der Name muss mindestens zwei Zeichen haben.' });
    }
    await query('UPDATE lobbies SET name = $1 WHERE id = $2', [name, lobbyId]);
    res.json({ lobby: { ...membership.lobby, name, role: membership.role, joinCode: membership.lobby.joinCode } });
  } catch (error) {
    respondWithError(res, error, 'Lobby konnte nicht aktualisiert werden.');
  }
});

app.post('/api/lobbies/:id/join-code', async (req, res) => {
  try {
    const lobbyId = Number(req.params.id);
    if (!Number.isFinite(lobbyId)) {
      return res.status(400).json({ error: 'Ungültige Lobby-ID.' });
    }
    const membership = await loadLobbyMembership(lobbyId, req.user.id);
    if (!membership.isAdmin) {
      throw createHttpError(403, 'Nur Admins können den Lobby-Code erneuern.');
    }
    const joinCode = await generateUniqueJoinCode();
    await query('UPDATE lobbies SET join_code = $1 WHERE id = $2', [joinCode, lobbyId]);
    res.json({ joinCode });
  } catch (error) {
    respondWithError(res, error, 'Lobby-Code konnte nicht erneuert werden.');
  }
});

app.delete('/api/lobbies/:id', async (req, res) => {
  try {
    const lobbyId = Number(req.params.id);
    if (!Number.isFinite(lobbyId)) {
      return res.status(400).json({ error: 'Ungültige Lobby-ID.' });
    }
    const membership = await loadLobbyMembership(lobbyId, req.user.id);
    if (membership.role !== 'owner') {
      throw createHttpError(403, 'Nur Eigentümer:innen können diese Lobby löschen.');
    }
    const result = await query('DELETE FROM lobbies WHERE id = $1 AND owner_id = $2', [lobbyId, req.user.id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Lobby wurde nicht gefunden.' });
    }
    await ensureDefaultLobbyForUser(req.user.id);
    res.status(204).end();
  } catch (error) {
    respondWithError(res, error, 'Lobby konnte nicht gelöscht werden.');
  }
});

app.delete('/api/lobbies/:id/members/me', async (req, res) => {
  try {
    const lobbyId = Number(req.params.id);
    if (!Number.isFinite(lobbyId)) {
      return res.status(400).json({ error: 'Ungültige Lobby-ID.' });
    }
    const membership = await loadLobbyMembership(lobbyId, req.user.id);
    if (membership.role === 'owner') {
      return res.status(400).json({ error: 'Eigentümer:innen können ihre Hauptlobby nicht verlassen.' });
    }
    await query('DELETE FROM lobby_members WHERE lobby_id = $1 AND user_id = $2', [lobbyId, req.user.id]);
    await ensureDefaultLobbyForUser(req.user.id);
    res.status(204).end();
  } catch (error) {
    respondWithError(res, error, 'Lobby-Mitgliedschaft konnte nicht beendet werden.');
  }
});

app.get('/api/theme', async (req, res) => {
  try {
    const value = await getSetting('theme', { ownerId: req.user.id });
    res.json({ theme: typeof value === 'string' ? value : null });
  } catch (error) {
    respondWithError(res, error, 'Theme konnte nicht geladen werden.');
  }
});

app.put('/api/theme', async (req, res) => {
  try {
    const theme = normalizeTheme(req.body?.theme);
    if (!theme) {
      return res.status(400).json({ error: 'Ungültiges Theme.' });
    }
    await setSetting('theme', theme, { ownerId: req.user.id });
    res.json({ theme });
  } catch (error) {
    respondWithError(res, error, 'Theme konnte nicht gespeichert werden.');
  }
});

app.get('/api/saved-names', async (req, res) => {
  try {
    const membership = await ensureLobbyContext(req);
    const value = await getSetting('werwolfSavedNames', { lobbyId: membership.lobbyId });
    res.json({ names: Array.isArray(value) ? value : [] });
  } catch (error) {
    respondWithError(res, error, 'Gespeicherte Namen konnten nicht geladen werden.');
  }
});

app.put('/api/saved-names', async (req, res) => {
  try {
    const membership = await ensureLobbyContext(req, { requireAdmin: true });
    const names = Array.isArray(req.body?.names)
      ? req.body.names.filter((name) => typeof name === 'string' && name.trim().length > 0)
      : [];
    await setSetting('werwolfSavedNames', names, { lobbyId: membership.lobbyId });
    res.json({ names });
  } catch (error) {
    respondWithError(res, error, 'Gespeicherte Namen konnten nicht abgelegt werden.');
  }
});

app.get('/api/role-presets', async (req, res) => {
  try {
    const membership = await ensureLobbyContext(req);
    const value = await getSetting('werwolfSavedRoles', { lobbyId: membership.lobbyId });
    res.json({ roles: Array.isArray(value) ? value : [] });
  } catch (error) {
    respondWithError(res, error, 'Gespeicherte Rollen konnten nicht geladen werden.');
  }
});

app.put('/api/role-presets', async (req, res) => {
  try {
    const membership = await ensureLobbyContext(req, { requireAdmin: true });
    const roles = Array.isArray(req.body?.roles)
      ? req.body.roles
          .filter((role) => role && typeof role.name === 'string' && role.name.trim().length > 0)
          .map((role) => ({
            name: role.name.trim(),
            quantity: Number.isFinite(role.quantity) ? Math.max(0, Math.round(role.quantity)) : 0,
          }))
      : [];
    await setSetting('werwolfSavedRoles', roles, { lobbyId: membership.lobbyId });
    res.json({ roles });
  } catch (error) {
    respondWithError(res, error, 'Gespeicherte Rollen konnten nicht abgelegt werden.');
  }
});

app.get('/api/storage/:key', async (req, res) => {
  try {
    const key = req.params.key;
    const membership = await ensureLobbyContext(req);
    const value = await getSetting(key, { lobbyId: membership.lobbyId });
    res.json({ key, value: value ?? null });
  } catch (error) {
    respondWithError(res, error, 'Persistenter Wert konnte nicht geladen werden.');
  }
});

app.put('/api/storage/:key', async (req, res) => {
  try {
    const key = req.params.key;
    const { value = null } = req.body || {};
    const membership = await ensureLobbyContext(req, { requireAdmin: true });
    await setSetting(key, value, { lobbyId: membership.lobbyId });
    res.json({ key, value });
  } catch (error) {
    respondWithError(res, error, 'Persistenter Wert konnte nicht gespeichert werden.');
  }
});

app.delete('/api/storage/:key', async (req, res) => {
  try {
    const key = req.params.key;
    const membership = await ensureLobbyContext(req, { requireAdmin: true });
    await removeSetting(key, { lobbyId: membership.lobbyId });
    res.status(204).end();
  } catch (error) {
    respondWithError(res, error, 'Persistenter Wert konnte nicht entfernt werden.');
  }
});

async function listSessions(lobbyId, ownerId) {
  const result = await query(
    `SELECT timestamp, data
       FROM sessions
      WHERE lobby_id = $1 OR (lobby_id IS NULL AND owner_id = $2)
      ORDER BY timestamp DESC
      LIMIT 20`,
    [lobbyId, ownerId]
  );
  return result.rows
    .map((row) => ({ ...row.data, timestamp: Number(row.timestamp) }))
    .filter((session) => Number.isFinite(session.timestamp));
}

async function upsertSession(session, { lobbyId, ownerId }) {
  await query(
    `INSERT INTO sessions (timestamp, data, created_at, owner_id, lobby_id)
     VALUES ($1, $2, NOW(), $3, $4)
     ON CONFLICT (timestamp)
     DO UPDATE SET data = EXCLUDED.data,
                   owner_id = EXCLUDED.owner_id,
                   lobby_id = EXCLUDED.lobby_id`,
    [session.timestamp, session, ownerId, lobbyId]
  );

  await pruneSessionStorage(lobbyId, ownerId, 20);
}

async function upsertSessionTimeline(session, { lobbyId, ownerId }) {
  if (!session?.timeline || typeof session.timeline !== 'object') {
    return;
  }

  await query(
    `INSERT INTO session_timelines (session_timestamp, timeline, created_at, owner_id, lobby_id)
     VALUES ($1, $2, NOW(), $3, $4)
     ON CONFLICT (session_timestamp)
     DO UPDATE SET timeline = EXCLUDED.timeline,
                   owner_id = EXCLUDED.owner_id,
                   lobby_id = EXCLUDED.lobby_id,
                   updated_at = NOW()`,
    [session.timestamp, session.timeline, ownerId, lobbyId]
  );
}

async function upsertSessionMetrics(session, { lobbyId, ownerId }) {
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
    `INSERT INTO session_metrics (session_timestamp, winner, player_count, action_count, checkpoint_count, game_length_ms, created_at, owner_id, lobby_id)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8)
     ON CONFLICT (session_timestamp)
     DO UPDATE SET winner = EXCLUDED.winner,
                   player_count = EXCLUDED.player_count,
                   action_count = EXCLUDED.action_count,
                   checkpoint_count = EXCLUDED.checkpoint_count,
                   game_length_ms = EXCLUDED.game_length_ms,
                   owner_id = EXCLUDED.owner_id,
                   lobby_id = EXCLUDED.lobby_id,
                   updated_at = NOW()`,
    [session.timestamp, winnerTitle, playerCount, actionCount, checkpointCount, gameLengthMs, ownerId, lobbyId]
  );
}

async function pruneSessionStorage(lobbyId, ownerId, limit = 20) {
  await query(
    `DELETE FROM sessions
      WHERE (lobby_id = $1 OR (lobby_id IS NULL AND owner_id = $2))
        AND timestamp NOT IN (
          SELECT timestamp FROM sessions
            WHERE (lobby_id = $1 OR (lobby_id IS NULL AND owner_id = $2))
            ORDER BY timestamp DESC
            LIMIT $3
        )`,
    [lobbyId, ownerId, limit]
  );

  await query(
    `DELETE FROM session_timelines
      WHERE (lobby_id = $1 OR (lobby_id IS NULL AND owner_id = $2))
        AND session_timestamp NOT IN (
          SELECT timestamp FROM sessions
            WHERE (lobby_id = $1 OR (lobby_id IS NULL AND owner_id = $2))
            ORDER BY timestamp DESC
            LIMIT $3
        )`,
    [lobbyId, ownerId, limit]
  );

  await query(
    `DELETE FROM session_metrics
      WHERE (lobby_id = $1 OR (lobby_id IS NULL AND owner_id = $2))
        AND session_timestamp NOT IN (
          SELECT timestamp FROM sessions
            WHERE (lobby_id = $1 OR (lobby_id IS NULL AND owner_id = $2))
            ORDER BY timestamp DESC
            LIMIT $3
        )`,
    [lobbyId, ownerId, limit]
  );
}

app.get('/api/sessions', async (req, res) => {
  try {
    const membership = await ensureLobbyContext(req);
    const sessions = await listSessions(membership.lobbyId, req.user.id);
    res.json({ sessions });
  } catch (error) {
    respondWithError(res, error, 'Sessions konnten nicht geladen werden.');
  }
});

app.post('/api/sessions', async (req, res) => {
  try {
    const membership = await ensureLobbyContext(req, { requireAdmin: true });
    const session = req.body?.session;
    if (!session || typeof session !== 'object') {
      return res.status(400).json({ error: 'Ungültige Session.' });
    }
    const timestamp = Number(session.timestamp || Date.now());
    const normalized = { ...session, timestamp, lobbyId: membership.lobbyId };
    const context = { lobbyId: membership.lobbyId, ownerId: req.user.id };
    await upsertSession(normalized, context);
    await upsertSessionTimeline(normalized, context);
    await upsertSessionMetrics(normalized, context);
    const sessions = await listSessions(membership.lobbyId, req.user.id);
    res.status(201).json({ session: normalized, sessions });
  } catch (error) {
    respondWithError(res, error, 'Session konnte nicht gespeichert werden.');
  }
});

app.get('/api/sessions/:timestamp/timeline', async (req, res) => {
  try {
    const membership = await ensureLobbyContext(req);
    const timestamp = Number(req.params.timestamp);
    if (!Number.isFinite(timestamp)) {
      return res.status(400).json({ error: 'Ungültiger Zeitstempel.' });
    }
    const result = await query(
      `SELECT timeline
         FROM session_timelines
        WHERE session_timestamp = $1
          AND (lobby_id = $2 OR (lobby_id IS NULL AND owner_id = $3))
        LIMIT 1`,
      [timestamp, membership.lobbyId, req.user.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Keine Timeline für diese Session gefunden.' });
    }
    return res.json({ timeline: result.rows[0].timeline });
  } catch (error) {
    console.error('Timeline konnte nicht geladen werden:', error);
    return respondWithError(res, error, 'Timeline konnte nicht geladen werden.');
  }
});

app.delete('/api/sessions/:timestamp', async (req, res) => {
  try {
    const membership = await ensureLobbyContext(req, { requireAdmin: true });
    const timestamp = Number(req.params.timestamp);
    if (!Number.isFinite(timestamp)) {
      return res.status(400).json({ error: 'Ungültiger Zeitstempel.' });
    }
    const deleteParams = [timestamp, membership.lobbyId, req.user.id];
    const sessionResult = await query(
      `DELETE FROM sessions
        WHERE timestamp = $1
          AND (lobby_id = $2 OR (lobby_id IS NULL AND owner_id = $3))`,
      deleteParams
    );
    await query(
      `DELETE FROM session_timelines
        WHERE session_timestamp = $1
          AND (lobby_id = $2 OR (lobby_id IS NULL AND owner_id = $3))`,
      deleteParams
    );
    await query(
      `DELETE FROM session_metrics
        WHERE session_timestamp = $1
          AND (lobby_id = $2 OR (lobby_id IS NULL AND owner_id = $3))`,
      deleteParams
    );
    if (sessionResult.rowCount === 0) {
      return res.status(404).json({ error: 'Keine passende Session gefunden.' });
    }
    res.status(204).end();
  } catch (error) {
    respondWithError(res, error, 'Session konnte nicht gelöscht werden.');
  }
});

const VILLAGE_ROLES = new Set([
  'Dorfbewohner',
  'Seer',
  'Jäger',
  'Hexe',
  'Stumme Jule',
  'Inquisitor',
  'Sündenbock',
  'Geschwister',
  'Geist',
  'Michael Jackson',
  'Friedenstifter',
]);

const WERWOLF_ROLES = new Set(['Werwolf', 'Verfluchte']);

function normalizePlayerName(name) {
  if (typeof name !== 'string') {
    return null;
  }
  const normalized = name.replace(/\s+/g, ' ').trim();
  return normalized.length > 0 ? normalized : null;
}

function getTeamForRole(roleName) {
  if (typeof roleName !== 'string') {
    return 'special';
  }
  if (WERWOLF_ROLES.has(roleName)) {
    return 'werwolf';
  }
  if (VILLAGE_ROLES.has(roleName)) {
    return 'village';
  }
  return 'special';
}

function deriveWinningInfoFromSession(session) {
  const winner = session?.metadata?.winner;
  if (!winner || typeof winner.title !== 'string') {
    return { faction: null, winners: [] };
  }

  const normalizedTitle = winner.title.trim().toLowerCase();
  const players = Array.isArray(session?.players) ? session.players : [];
  const roles = Array.isArray(session?.rolesAssigned) ? session.rolesAssigned : [];
  const lovers = Array.isArray(session?.lovers) ? session.lovers : [];
  const winners = new Set();
  let faction = null;

  const addWinner = (name) => {
    const normalized = normalizePlayerName(name);
    if (normalized) {
      winners.add(normalized);
    }
  };

  switch (normalizedTitle) {
    case 'werwölfe gewinnen!':
      faction = 'werwolf';
      players.forEach((playerName, index) => {
        if (getTeamForRole(roles[index]) === 'werwolf') {
          addWinner(playerName);
        }
      });
      break;
    case 'dorfbewohner gewinnen!':
      faction = 'village';
      players.forEach((playerName, index) => {
        if (getTeamForRole(roles[index]) !== 'werwolf') {
          addWinner(playerName);
        }
      });
      break;
    case 'die liebenden gewinnen!':
      faction = 'lovers';
      lovers.forEach((pair) => {
        if (Array.isArray(pair)) {
          pair.forEach(addWinner);
        }
      });
      break;
    case 'der henker gewinnt!':
      faction = 'henker';
      roles.forEach((roleName, index) => {
        if (roleName === 'Henker') {
          addWinner(players[index]);
        }
      });
      if (winners.size === 0 && typeof winner.message === 'string') {
        const match = winner.message.match(/^([^!]+?) hat sein Ziel erreicht/i);
        if (match && match[1]) {
          addWinner(match[1]);
        }
      }
      break;
    case 'der friedenstifter gewinnt!':
      faction = 'friedenstifter';
      roles.forEach((roleName, index) => {
        if (roleName === 'Friedenstifter') {
          addWinner(players[index]);
        }
      });
      break;
    default:
      break;
  }

  return { faction, winners: Array.from(winners) };
}

function ensurePlayerAggregate(map, name) {
  if (!map.has(name)) {
    map.set(name, {
      name,
      games: 0,
      wins: 0,
      deaths: 0,
      roles: new Map(),
      lastPlayedAt: 0,
    });
  }
  return map.get(name);
}

app.get('/api/analytics', async (req, res) => {
  try {
    const membership = await ensureLobbyContext(req, { requireAdmin: true });
    const lobbyId = membership.lobbyId;
    const ownerId = req.user.id;

    const summaryResult = await query(
      `SELECT
         COUNT(*)::int AS session_count,
         AVG(game_length_ms)::bigint AS average_game_length_ms,
         AVG(action_count)::numeric AS average_action_count,
         AVG(player_count)::numeric AS average_player_count
        FROM session_metrics
       WHERE lobby_id = $1 OR (lobby_id IS NULL AND owner_id = $2)`
    , [lobbyId, ownerId]);
    const summaryRow = summaryResult.rows[0] || {};

    const winRateResult = await query(
      `SELECT winner, COUNT(*)::int AS count
         FROM session_metrics
        WHERE (lobby_id = $1 OR (lobby_id IS NULL AND owner_id = $2))
          AND winner IS NOT NULL AND winner <> ''
        GROUP BY winner
        ORDER BY count DESC`,
      [lobbyId, ownerId]
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
       WHERE data ? 'metadata'
         AND (lobby_id = $1 OR (lobby_id IS NULL AND owner_id = $2))`,
      [lobbyId, ownerId]
    );
    const metaRow = metaResult.rows[0] || {};

    const sessionResult = await query(
      `SELECT timestamp, data
         FROM sessions
        WHERE lobby_id = $1 OR (lobby_id IS NULL AND owner_id = $2)
        ORDER BY timestamp DESC`,
      [lobbyId, ownerId]
    );

    const playerAggregates = new Map();

    sessionResult.rows.forEach((row) => {
      const sessionData = row?.data || {};
      const players = Array.isArray(sessionData.players) ? sessionData.players : [];
      if (players.length === 0) {
        return;
      }

      const roles = Array.isArray(sessionData.rolesAssigned) ? sessionData.rolesAssigned : [];
      const deadPlayers = Array.isArray(sessionData.deadPlayers) ? sessionData.deadPlayers : [];
      const deadSet = new Set(deadPlayers
        .map((name) => normalizePlayerName(name))
        .filter(Boolean));
      const winningInfo = deriveWinningInfoFromSession(sessionData);
      const winnerSet = new Set(Array.isArray(winningInfo.winners) ? winningInfo.winners : []);
      const timestamp = Number(sessionData.timestamp);

      players.forEach((playerName, index) => {
        const normalizedName = normalizePlayerName(playerName);
        if (!normalizedName) {
          return;
        }
        const aggregate = ensurePlayerAggregate(playerAggregates, normalizedName);
        aggregate.games += 1;
        if (Number.isFinite(timestamp)) {
          aggregate.lastPlayedAt = Math.max(aggregate.lastPlayedAt || 0, timestamp);
        }

        const roleName = roles[index] || null;
        if (roleName) {
          aggregate.roles.set(roleName, (aggregate.roles.get(roleName) || 0) + 1);
        }

        if (winnerSet.has(normalizedName)) {
          aggregate.wins += 1;
        }

        if (deadSet.has(normalizedName)) {
          aggregate.deaths += 1;
        }
      });
    });

    const stats = Array.from(playerAggregates.values()).map((aggregate) => {
      const survivals = Math.max(0, aggregate.games - aggregate.deaths);
      const winRate = aggregate.games > 0 ? aggregate.wins / aggregate.games : null;
      const survivalRate = aggregate.games > 0 ? survivals / aggregate.games : null;
      const deathRate = aggregate.games > 0 ? aggregate.deaths / aggregate.games : null;
      const roleEntries = Array.from(aggregate.roles.entries())
        .map(([role, count]) => ({ role, count }))
        .sort((a, b) => {
          if (b.count === a.count) {
            return a.role.localeCompare(b.role, 'de');
          }
          return b.count - a.count;
        });

      return {
        name: aggregate.name,
        games: aggregate.games,
        wins: aggregate.wins,
        deaths: aggregate.deaths,
        survivals,
        winRate,
        survivalRate,
        deathRate,
        favoriteRole: roleEntries[0] || null,
        topRoles: roleEntries.slice(0, 5),
        lastPlayedAt: aggregate.lastPlayedAt || null,
      };
    });

    const compareByWin = (a, b) => {
      if (b.wins === a.wins) {
        const rateA = Number.isFinite(a.winRate) ? a.winRate : -1;
        const rateB = Number.isFinite(b.winRate) ? b.winRate : -1;
        if (rateB === rateA) {
          if (b.games === a.games) {
            return a.name.localeCompare(b.name, 'de');
          }
          return b.games - a.games;
        }
        return rateB - rateA;
      }
      return b.wins - a.wins;
    };

    const statsSorted = stats
      .slice()
      .sort(compareByWin);

    const topWinners = stats
      .filter((stat) => stat.wins > 0)
      .sort(compareByWin)
      .slice(0, 5)
      .map(({ name, wins, games, winRate }) => ({ name, wins, games, winRate }));

    const mostDeaths = stats
      .filter((stat) => stat.deaths > 0)
      .sort((a, b) => {
        if (b.deaths === a.deaths) {
          const rateA = Number.isFinite(a.deathRate) ? a.deathRate : -1;
          const rateB = Number.isFinite(b.deathRate) ? b.deathRate : -1;
          if (rateB === rateA) {
            if (b.games === a.games) {
              return a.name.localeCompare(b.name, 'de');
            }
            return b.games - a.games;
          }
          return rateB - rateA;
        }
        return b.deaths - a.deaths;
      })
      .slice(0, 5)
      .map(({ name, deaths, games, deathRate }) => ({ name, deaths, games, deathRate }));

    const bestSurvivors = stats
      .filter((stat) => stat.games >= 2)
      .sort((a, b) => {
        const rateA = Number.isFinite(a.survivalRate) ? a.survivalRate : -1;
        const rateB = Number.isFinite(b.survivalRate) ? b.survivalRate : -1;
        if (rateB === rateA) {
          if (b.survivals === a.survivals) {
            if (b.games === a.games) {
              return a.name.localeCompare(b.name, 'de');
            }
            return b.games - a.games;
          }
          return b.survivals - a.survivals;
        }
        return rateB - rateA;
      })
      .slice(0, 5)
      .map(({ name, survivals, games, survivalRate }) => ({ name, survivals, games, survivalRate }));

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
      players: {
        totalCount: stats.length,
        trackedSessions: sessionResult.rowCount,
        topWinners,
        mostDeaths,
        bestSurvivors,
        stats: statsSorted,
      },
    });
  } catch (error) {
    console.error('Analytics konnten nicht geladen werden:', error);
    respondWithError(res, error, 'Analytics konnten nicht geladen werden.');
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
