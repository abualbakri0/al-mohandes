/*
 * One-shot migration + data import into the developer's OWN Supabase project.
 * Usage (password is passed via env, never stored in a file):
 *   $env:PGURL="postgresql://..."; node setup-and-import.cjs
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const PGURL = process.env.PGURL;
if (!PGURL) {
  console.error('ERROR: set PGURL env var to your connection string first.');
  process.exit(1);
}

const ROOT = __dirname;
const MIGRATION = path.join(ROOT, 'supabase', 'migrations', '20261010130000_full_schema_with_user_passwords.sql');
const DUMP = path.join(ROOT, '_migration_dump');

// Order matters only for FK (none here), but keep a sensible order.
const TABLES = [
  'registrations', 'user_passwords', 'lectures', 'assignments',
  'study_tasks', 'notifications', 'exams', 'app_settings',
  'reference_materials', 'feedback_messages'
];

function escIdent(id) { return '"' + id.replace(/"/g, '""') + '"'; }

async function importTable(client, table) {
  const file = path.join(DUMP, table + '.json');
  if (!fs.existsSync(file)) { console.log(`  - ${table}: (no dump file, skipped)`); return; }
  const raw = fs.readFileSync(file, 'utf8').trim();
  if (!raw) { console.log(`  - ${table}: (empty, skipped)`); return; }
  let rows = JSON.parse(raw);
  if (rows && !Array.isArray(rows)) rows = [rows];
  if (!rows.length) { console.log(`  - ${table}: (0 rows)`); return; }

  // Fresh start for this table to avoid duplicates on re-run.
  await client.query(`TRUNCATE TABLE ${escIdent(table)} RESTART IDENTITY CASCADE;`);

  const cols = Object.keys(rows[0]);
  const placeholders = [];
  const values = [];
  let i = 1;
  for (const r of rows) {
    const tuple = cols.map(c => { const v = r[c]; return v === undefined ? null : v; });
    placeholders.push('(' + tuple.map(() => '$' + (i++)).join(', ') + ')');
    values.push(...tuple);
  }
  const sql = `INSERT INTO ${escIdent(table)} (${cols.map(escIdent).join(', ')}) VALUES ${placeholders.join(', ')}`;
  await client.query(sql, values);
  console.log(`  + ${table}: inserted ${rows.length} row(s)`);
}

(async () => {
  const client = new Client({ connectionString: PGURL, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    console.log('Connected to your Supabase project.');

    console.log('\n[1/2] Creating schema (tables + policies + storage)...');
    const sql = fs.readFileSync(MIGRATION, 'utf8');
    await client.query(sql);
    console.log('Schema created successfully.');

    console.log('\n[2/2] Importing your data...');
    for (const t of TABLES) {
      if (t === 'user_passwords') { console.log('  - user_passwords: (empty; users set passwords on first login)'); continue; }
      await importTable(client, t);
    }

    console.log('\nDONE. All tables created and your data imported.');
  } catch (e) {
    console.error('FAILED:', e.message);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
})();
