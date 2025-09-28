const fs = require('fs');
const path = require('path');
const { withTransaction, query } = require('./db');

async function ensureMigrationsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      run_on TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function hasMigration(name) {
  const result = await query('SELECT 1 FROM schema_migrations WHERE name = $1', [name]);
  return result.rowCount > 0;
}

async function applyMigration(name, sql) {
  await withTransaction(async (client) => {
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
  });
}

async function runMigrations() {
  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  await ensureMigrationsTable();

  const applied = [];
  for (const file of files) {
    const alreadyApplied = await hasMigration(file);
    if (alreadyApplied) {
      continue;
    }

    const fullPath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(fullPath, 'utf8');
    await applyMigration(file, sql);
    applied.push(file);
  }

  return applied;
}

if (require.main === module) {
  runMigrations()
    .then((applied) => {
      if (applied.length === 0) {
        console.log('Keine neuen Migrationen.');
      } else {
        applied.forEach((name) => console.log(`Migration ausgeführt: ${name}`));
      }
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration fehlgeschlagen:', error);
      process.exit(1);
    });
}

module.exports = runMigrations;
