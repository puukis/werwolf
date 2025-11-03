require('dotenv').config();
const { Pool } = require('pg');

function buildPoolConfigs() {
  const connectionString = process.env.DATABASE_URL;
  const sslMode = process.env.PGSSLMODE;

  if (connectionString) {
    return [
      {
        connectionString,
        ssl: sslMode === 'require' ? { rejectUnauthorized: false } : undefined,
      },
    ];
  }

  const host = process.env.PGHOST || 'localhost';
  const port = Number(process.env.PGPORT) || 5432;
  const database = process.env.PGDATABASE || 'werwolf';
  const baseConfig = { host, port, database };

  if (Object.prototype.hasOwnProperty.call(process.env, 'PGPASSWORD')) {
    const password = process.env.PGPASSWORD;
    if (password !== undefined && password !== null) {
      baseConfig.password = String(password);
    }
  }

  const candidates = [];
  const seenUsers = new Set();

  function pushUser(user) {
    if (!user || seenUsers.has(user)) {
      return;
    }
    seenUsers.add(user);
    candidates.push({ ...baseConfig, user });
  }

  pushUser(process.env.PGUSER);
  pushUser(process.env.USER);
  pushUser('postgres');

  return candidates;
}

async function createPool() {
  const configs = buildPoolConfigs();
  let lastError = null;

  for (const config of configs) {
    const pool = new Pool(config);
    try {
      await pool.query('SELECT 1');
      if (lastError && lastError.code === '28000') {
        console.warn(
          `PostgreSQL-Rolle "${lastError.roleName}" nicht gefunden. Verwende Fallback-Rolle "${config.user}".`
        );
      }
      return pool;
    } catch (error) {
      await pool.end().catch(() => {});

      if (error?.code === '28000') {
        lastError = { code: error.code, roleName: config.user };
        continue;
      }

      throw error;
    }
  }

  if (lastError?.code === '28000') {
    throw new Error(
      'Es konnte keine gültige PostgreSQL-Rolle gefunden werden. Setze PGUSER oder erstelle die Rolle in deiner Datenbank.'
    );
  }

  throw lastError || new Error('Verbindung zur Datenbank fehlgeschlagen.');
}

const poolPromise = createPool();

let hasLoggedPermissionDeniedHint = false;

function resolveConfiguredRole() {
  if (process.env.PGUSER) {
    return process.env.PGUSER;
  }

  if (process.env.DATABASE_URL) {
    try {
      const parsed = new URL(process.env.DATABASE_URL);
      if (parsed.username) {
        return decodeURIComponent(parsed.username);
      }
    } catch (error) {
      // Ungültige URL ignorieren – Hinweis erfolgt unten dennoch.
    }
  }

  return null;
}

function maybeLogPermissionDeniedHint(error) {
  if (hasLoggedPermissionDeniedHint || error?.code !== '42501') {
    return;
  }

  hasLoggedPermissionDeniedHint = true;

  const configuredUser = resolveConfiguredRole();
  const effectiveUser = configuredUser || process.env.USER || '<unbekannt>';

  console.error(
    [
      'PostgreSQL-Zugriff verweigert (Fehler 42501).',
      'Bitte stelle sicher, dass die verwendete Rolle ausreichende Rechte auf das Schema besitzt.',
      `Aktuelle Rolle laut Konfiguration: ${effectiveUser}.`,
      'Tipp: Setze PGUSER/PGPASSWORD in deiner .env-Datei oder gewähre der Rolle SELECT/INSERT/UPDATE/DELETE auf die Tabellen.',
    ].join(' ')
  );
}

async function query(text, params) {
  const pool = await poolPromise;
  try {
    return await pool.query(text, params);
  } catch (error) {
    maybeLogPermissionDeniedHint(error);
    throw error;
  }
}

async function withTransaction(handler) {
  const pool = await poolPromise;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await handler(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  getPool: () => poolPromise,
  query,
  withTransaction,
};
