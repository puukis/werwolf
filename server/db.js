require('dotenv').config();
const { Pool } = require('pg');

function createPool() {
  const connectionString = process.env.DATABASE_URL;
  const sslMode = process.env.PGSSLMODE;

  if (connectionString) {
    return new Pool({
      connectionString,
      ssl: sslMode === 'require' ? { rejectUnauthorized: false } : undefined,
    });
  }

  const host = process.env.PGHOST || 'localhost';
  const port = Number(process.env.PGPORT) || 5432;
  const user = process.env.PGUSER || process.env.USER || 'postgres';
  const password = process.env.PGPASSWORD || undefined;
  const database = process.env.PGDATABASE || 'werwolf';

  return new Pool({
    host,
    port,
    user,
    password,
    database,
  });
}

const pool = createPool();

async function query(text, params) {
  return pool.query(text, params);
}

async function withTransaction(handler) {
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
  pool,
  query,
  withTransaction,
};
