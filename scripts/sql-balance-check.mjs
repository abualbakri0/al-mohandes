// Cheap structural check for hand-written SQL migrations (no Postgres needed).
// Verifies dollar-quote balance, a single BEGIN/COMMIT pair, and that every
// $$ / $tag$ opener has a matching closer in order.
// Usage: node scripts/sql-balance-check.mjs supabase/migrations/*.sql
import { readFileSync } from 'node:fs';

let bad = 0;

for (const file of process.argv.slice(2)) {
  const src = readFileSync(file, 'utf8');
  const lines = src.split(/\r?\n/).length;

  const begin = (src.match(/^\s*BEGIN\s*;/gm) || []).length;
  const commit = (src.match(/^\s*COMMIT\s*;/gm) || []).length;
  const doBlocks = (src.match(/\bDO\s+\$/g) || []).length;
  const createFn = (src.match(/CREATE (OR REPLACE )?FUNCTION/g) || []).length;

  // كل علامة دولار: $$ أو $tag$
  const tags = [...src.matchAll(/\$[A-Za-z_]*\$/g)].map((m) => m[0]);
  const counts = {};
  for (const t of tags) counts[t] = (counts[t] || 0) + 1;

  let balanced = true;
  const detail = [];
  for (const [tag, n] of Object.entries(counts)) {
    const ok = n % 2 === 0;
    if (!ok) balanced = false;
    detail.push(`  tag ${tag} x${n} ${ok ? 'ok' : 'UNBALANCED'}`);
  }
  // الترتيب: يجب أن يُفتح ويُغلق بالتناوب (لا تداخل)
  const stack = [];
  let nested = true;
  for (const t of tags) {
    if (stack.length && stack[stack.length - 1] === t) stack.pop();
    else if (!stack.includes(t)) stack.push(t);
    else {
      nested = false;
      break;
    }
  }
  if (stack.length) nested = false;

  const okAll = balanced && nested && begin === commit;
  if (!okAll) bad++;
  console.log(`=== ${file}`);
  console.log(`  lines: ${lines} | BEGIN: ${begin} | COMMIT: ${commit} | DO: ${doBlocks} | CREATE FUNCTION: ${createFn}`);
  console.log(detail.join('\n'));
  if (!nested) console.log('  NESTING: broken (tag closed out of order)');
  console.log(`  RESULT: ${okAll ? 'ok' : 'PROBLEM'}`);
}

process.exit(bad ? 1 : 0);
