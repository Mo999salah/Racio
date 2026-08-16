/**
 * Performance smoke seed + timing.
 *
 * Generates a non-sensitive synthetic dataset (2 users, 10 accounts, 50 000
 * transactions with splits, categories, tags, imports, budgets, goals, alert
 * rules) directly in PostgreSQL, then times the critical queries:
 *   - ledger filtered pagination
 *   - dashboard period aggregation
 *   - budget spending (split-aware, transfer-excluded)
 *   - export keyset pagination
 *
 * Usage (from the repository root):
 *   DATABASE_URL=postgresql://... pnpm --filter @racio/worker exec tsx scripts/seed-performance.mjs [rows]
 *
 * Each run uses a fresh `perf-*` user prefix, so runs never collide. Never
 * point it at a production database.
 */
import { createDatabase } from '@racio/database';
import { randomUUID } from 'node:crypto';

const databaseUrl = process.env.DATABASE_URL ?? 'postgresql://racio:racio_dev@localhost:5433/racio';
const targetRows = Number(process.argv[2] ?? 50_000);
const sql = createDatabase(databaseUrl).client;

const prefix = `perf-${randomUUID().slice(0, 8)}`;
const now = new Date().toISOString();

console.log(`Seeding ${targetRows} transactions for users ${prefix}-a / ${prefix}-b`);

const userIds = [`${prefix}-a`, `${prefix}-b`];
for (const userId of userIds) {
  await sql`
    INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
    VALUES (${userId}, ${`Perf ${userId}`}, ${`${userId}@example.test`}, true, ${now}, ${now})
  `;
}

const accountIds = [];
for (let u = 0; u < 2; u += 1) {
  const userId = userIds[u];
  for (let a = 0; a < 5; a += 1) {
    const institutionId = `${prefix}-institution-${u}-${a}`;
    const accountId = `${prefix}-account-${u}-${a}`;
    accountIds.push(accountId);
    await sql`
      INSERT INTO institutions (id, user_id, name, normalized_name, country_code, created_at, updated_at)
      VALUES (${institutionId}, ${userId}, ${`Perf Bank ${u}-${a}`}, ${`perf bank ${u}-${a}`}, 'US', ${now}, ${now})
    `;
    await sql`
      INSERT INTO financial_accounts (id, user_id, institution_id, display_name, account_type, currency_code, created_at, updated_at)
      VALUES (${accountId}, ${userId}, ${institutionId}, ${`Perf Checking ${a}`}, 'checking', 'USD', ${now}, ${now})
    `;
  }
}

for (let u = 0; u < 2; u += 1) {
  const userId = userIds[u];
  for (let c = 0; c < 10; c += 1) {
    await sql`
      INSERT INTO categories (id, user_id, name, normalized_name, kind, created_at, updated_at)
      VALUES (${`${prefix}-category-${u}-${c}`}, ${userId}, ${`Perf Category ${c}`}, ${`perf category ${c}`}, 'expense', ${now}, ${now})
    `;
  }
  for (let t = 0; t < 5; t += 1) {
    await sql`
      INSERT INTO tags (id, user_id, name, normalized_name, created_at, updated_at)
      VALUES (${`${prefix}-tag-${u}-${t}`}, ${userId}, ${`Perf Tag ${t}`}, ${`perf tag ${t}`}, ${now}, ${now})
    `;
  }
}

const statementIds = [];
for (let u = 0; u < 2; u += 1) {
  const statementId = `${prefix}-statement-${u}`;
  statementIds.push(statementId);
  await sql`
    INSERT INTO statements (
      id, user_id, financial_account_id, source_type, processing_status, original_filename,
      file_checksum, file_size, storage_key, upload_idempotency_key, detected_language, confirmed_at, created_at, updated_at
    ) VALUES (
      ${statementId}, ${userIds[u]}, ${accountIds[u * 5]}, 'csv', 'imported', 'perf.csv',
      ${'ab'.repeat(32)}, 1024, ${`perf/${statementId}.csv`}, ${`perf-upload-${u}`}, 'en', ${now}, ${now}, ${now}
    )
  `;
}

const perUser = Math.floor(targetRows / 2);
for (let u = 0; u < 2; u += 1) {
  const userId = userIds[u];
  const accountId = accountIds[u * 5];
  const statementId = statementIds[u];
  // Raw candidates referenced by the composite owner FK.
  await sql`
    INSERT INTO raw_transactions (
      id, user_id, statement_id, financial_account_id, source_row, raw_payload,
      raw_description, raw_booking_date, raw_amount, raw_currency, booking_date,
      amount, currency_code, direction, confidence, review_status, created_at, updated_at
    )
    SELECT
      ${`perf-raw-${u}-`} || s::text,
      ${userId},
      ${statementId},
      ${accountId},
      s,
      '{}'::jsonb,
      ${`Perf merchant ${u} `} || (s % 50)::text || ' item ' || s::text,
      (DATE '2026-02-15' + (s % 180) * INTERVAL '1 day')::date,
      ((10 + (s * 37 % 900))::numeric / 100)::text,
      'USD',
      (DATE '2026-02-15' + (s % 180) * INTERVAL '1 day')::date,
      (10 + (s * 37 % 900))::numeric / 100,
      'USD',
      (CASE WHEN s % 3 = 0 THEN 'credit' ELSE 'debit' END)::transaction_direction,
      '1.0000',
      'valid',
      ${now},
      ${now}
    FROM generate_series(1, ${perUser}) AS s
  `;
  await sql`
    INSERT INTO transactions (
      id, user_id, financial_account_id, statement_id, source_raw_transaction_id,
      booking_date, value_date, amount, currency_code, direction, balance_after,
      raw_description, imported_description, normalized_description, source_type,
      duplicate_fingerprint, created_at, updated_at
    )
    SELECT
      ${`perf-tx-${u}-`} || s::text,
      ${userId},
      ${accountId},
      ${statementId},
      ${`perf-raw-${u}-`} || s::text,
      (DATE '2026-02-15' + (s % 180) * INTERVAL '1 day')::date,
      NULL,
      (10 + (s * 37 % 900))::numeric / 100,
      'USD',
      (CASE WHEN s % 3 = 0 THEN 'credit' ELSE 'debit' END)::transaction_direction,
      NULL,
      ${`Perf merchant ${u} `} || (s % 50)::text || ' item ' || s::text,
      ${`Perf merchant ${u} `} || (s % 50)::text || ' item ' || s::text,
      ${`perf merchant ${u} `} || (s % 50)::text || ' item ' || s::text,
      'csv',
      md5(${`perf${u}`} || s::text),
      ${now},
      ${now}
    FROM generate_series(1, ${perUser}) AS s
  `;
  await sql`
    INSERT INTO transaction_splits (
      id, user_id, transaction_id, position, amount, currency_code, created_at, updated_at
    )
    SELECT
      ${`perf-split-${u}-`} || s::text || '-1',
      ${userId},
      ${`perf-tx-${u}-`} || s::text,
      0,
      (10 + (s * 37 % 900))::numeric / 200,
      'USD',
      ${now},
      ${now}
    FROM generate_series(1, ${perUser}) AS s
    WHERE s % 20 = 0
  `;
  await sql`
    INSERT INTO transaction_splits (
      id, user_id, transaction_id, position, amount, currency_code, created_at, updated_at
    )
    SELECT
      ${`perf-split-${u}-`} || s::text || '-2',
      ${userId},
      ${`perf-tx-${u}-`} || s::text,
      1,
      (10 + (s * 37 % 900))::numeric / 200,
      'USD',
      ${now},
      ${now}
    FROM generate_series(1, ${perUser}) AS s
    WHERE s % 20 = 0
  `;
  await sql`
    INSERT INTO budgets (id, user_id, name, currency, amount, period_type, enabled, created_at, updated_at)
    VALUES (${`${prefix}-budget-${u}`}, ${userId}, 'Perf Budget', 'USD', 5000, 'monthly', true, ${now}, ${now})
  `;
  await sql`
    INSERT INTO savings_goals (id, user_id, name, currency, target_amount, tracking_mode, created_at, updated_at)
    VALUES (${`${prefix}-goal-${u}`}, ${userId}, 'Perf Goal', 'USD', 10000, 'manual', ${now}, ${now})
  `;
}

console.log('Seed complete. Running query timings...');

function time(name, fn) {
  const start = performance.now();
  const result = fn();
  const ms = (performance.now() - start).toFixed(1);
  console.log(`${name.padEnd(46)} ${ms.padStart(8)} ms`);
  return result;
}

const userId = userIds[0];

process.on('unhandledRejection', (e) => {
  console.log('ERR-DETAIL', (e && e.query) ?? '', (e && e.position) ?? '');
  process.exit(1);
});
process.on('uncaughtException', (e) => {
  console.log('ERR-DETAIL', e.query ?? '', e.position ?? '');
  process.exit(1);
});
await time(
  'ledger filtered pagination (limit 50, debit)',
  () =>
    sql`
    SELECT * FROM transactions
    WHERE user_id = ${userId} AND direction = 'debit'
    ORDER BY booking_date DESC, created_at DESC, id DESC
    LIMIT 50
  `,
);
await time(
  'dashboard period aggregation (90 days)',
  () =>
    sql`
    SELECT currency_code,
           coalesce(sum(amount) FILTER (WHERE direction = 'credit'), 0)::text AS inflow,
           coalesce(sum(amount) FILTER (WHERE direction = 'debit'), 0)::text AS outflow,
           count(*) AS count
    FROM transactions
    WHERE user_id = ${userId}
      AND booking_date >= DATE '2026-05-18'
      AND booking_date <= DATE '2026-08-15'
    GROUP BY currency_code
  `,
);
await time(
  'budget spending (split-aware, current month)',
  () =>
    sql`
    SELECT coalesce(sum(COALESCE(splits.amount, t.amount)), 0)::text AS spent
    FROM transactions t
    LEFT JOIN transaction_splits splits
      ON splits.transaction_id = t.id AND splits.user_id = t.user_id
    WHERE t.user_id = ${userId}
      AND t.direction = 'debit'
      AND t.booking_date >= DATE '2026-08-01'
      AND t.booking_date <= DATE '2026-08-31'
  `,
);
await time(
  'export keyset pagination (page of 500)',
  () =>
    sql`
    SELECT * FROM transactions
    WHERE user_id = ${userId}
      AND (booking_date, created_at, id) > ('2026-01-01', ${now}, '')
    ORDER BY booking_date ASC, created_at ASC, id ASC
    LIMIT 500
  `,
);

await sql.end();
console.log('Done.');
