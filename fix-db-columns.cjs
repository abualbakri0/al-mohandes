/**
 * One-off script: adds the two password columns to the `registrations` table
 * by connecting DIRECTLY to Postgres (DDL like ALTER TABLE cannot be done via
 * the anon/service REST API). Reads the connection string from a temp file to
 * keep the password out of the shell history.
 *
 * Usage:
 *   1) Write the connection string into d:/mohanndes_build/pgurl.txt
 *   2) node fix-db-columns.cjs
 */
const { Client } = require('pg');
const { readFileSync } = require('fs');

const PGURL_PATH = 'd:/mohanndes_build/pgurl.txt';

async function main() {
  const connStr = readFileSync(PGURL_PATH, 'utf8').trim();
  if (!connStr.startsWith('postgres')) {
    throw new Error('pgurl.txt does not contain a postgres:// connection string');
  }

  const client = new Client({
    connectionString: connStr,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log('[ok] connected to database');

  await client.query(
    "ALTER TABLE public.registrations ADD COLUMN IF NOT EXISTS password_hash text;"
  );
  console.log('[ok] password_hash ensured');

  await client.query(
    "ALTER TABLE public.registrations ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;"
  );
  console.log('[ok] must_change_password ensured');

  const res = await client.query(
    `SELECT column_name, data_type, column_default
       FROM information_schema.columns
      WHERE table_name = 'registrations'
        AND column_name IN ('password_hash','must_change_password')
      ORDER BY column_name;`
  );
  console.log('[verify] columns now present:');
  for (const row of res.rows) console.log('   -', row.column_name, '(', row.data_type, ') default:', row.column_default);

  const pol = await client.query(
    `SELECT polname, polcmd FROM pg_policy WHERE polrelid = 'public.registrations'::regclass;`
  );
  console.log('[verify] RLS policies on registrations:', pol.rows.map((r) => r.polname + ':' + r.polcmd).join(', '));

  await client.end();
  console.log('[done] ALL GOOD');
}

main().catch((e) => {
  console.error('[error]', e.message);
  process.exit(1);
});
