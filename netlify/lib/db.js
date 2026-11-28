// Buyurtmalar bazasi bilan ishlovchi umumiy modul (order, telegram, kochirish, zaxira uchun).
// netlify/functions ichida emas — aks holda Netlify uni alohida funksiya qilib qo'yadi.
//
// Qaysi baza ishlatiladi:
//   - PGDATABASE bor va "pg" paketi o'rnatilgan bo'lsa — hostingdagi PostgreSQL.
//     Ulanish standart muhit o'zgaruvchilaridan: PGHOST (bo'lmasa localhost), PGPORT,
//     PGDATABASE, PGUSER, PGPASSWORD — ularni "pg" o'zi o'qiydi.
//   - Aks holda (masalan Netlify'da) — Supabase REST: SUPABASE_URL, SUPABASE_SECRET_KEY.
//
// Barcha SQL so'rovlar parametrli ($1, $2 ...) — matn so'rov ichiga qo'shilmaydi.

'use strict';

const TABLE = 'buyurtmalar';
const PAGE = 1000;
const SUPABASE_TIMEOUT = 8000;

let pg = null;
let pgMissing = false;
if (process.env.PGDATABASE) {
  try {
    pg = require('pg');
  } catch {
    pgMissing = true;
  }
}

const usingPostgres = !!pg;

// Bitta qator log — parol va manzil yozilmaydi.
if (usingPostgres) console.log('Baza: hostingdagi PostgreSQL');
else if (pgMissing) console.log('Baza: Supabase (PGDATABASE bor, lekin "pg" paketi o‘rnatilmagan)');
else console.log('Baza: Supabase');

// ---------- PostgreSQL ----------

let pool = null;
let tableReady = null;

function getPool() {
  if (!pool) {
    pool = new pg.Pool({
      host: process.env.PGHOST || 'localhost',
      max: 3,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      statement_timeout: 15000,
    });
    // Bo'sh turgan ulanishdagi xato jarayonni to'xtatib qo'ymasin.
    pool.on('error', (err) => console.error('PostgreSQL ulanish xatosi:', err.message));
  }
  return pool;
}

const CREATE_TABLE = `
create table if not exists ${TABLE} (
  id         bigint generated always as identity primary key,
  yaratilgan timestamptz not null default now(),
  ism        text    not null,
  telefon    text    not null,
  izoh       text,
  suvlar     jsonb   not null,
  jami       integer not null check (jami >= 0),
  holat      text    default 'yangi',
  rozilik    boolean not null check (rozilik)
)`;

// Birinchi ulanishda jadvalni yaratadi (bir marta; xato bo'lsa keyingi safar qayta urinadi).
function ensureTable() {
  if (!tableReady) {
    tableReady = getPool().query(CREATE_TABLE).then(() => undefined, (err) => {
      tableReady = null;
      throw err;
    });
  }
  return tableReady;
}

async function pgQuery(text, params) {
  await ensureTable();
  return getPool().query(text, params);
}

// ---------- Supabase REST ----------

function supabaseConfig() {
  const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return null;
  const headers = { apikey: key, Accept: 'application/json' };
  // Eski (JWT ko'rinishidagi) service_role kaliti Authorization sarlavhasini ham talab qiladi.
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
  return { url, headers };
}

async function supabaseGet(query, range) {
  const cfg = supabaseConfig();
  if (!cfg) throw new Error('Supabase sozlanmagan');
  const headers = { ...cfg.headers };
  if (range) {
    headers['Range-Unit'] = 'items';
    headers.Range = range;
  }
  const res = await fetch(`${cfg.url}/rest/v1/${TABLE}?${query}`, {
    headers,
    signal: AbortSignal.timeout(SUPABASE_TIMEOUT),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Supabase ${res.status}: ${detail.slice(0, 300)}`);
  }
  return res.json();
}

// So'rovga mos barcha qatorlarni 1000 tadan sahifalab oladi.
async function supabaseGetAll(params) {
  const query = params.toString();
  const all = [];
  for (let offset = 0; ; offset += PAGE) {
    const rows = await supabaseGet(query, `${offset}-${offset + PAGE - 1}`);
    all.push(...rows);
    if (rows.length < PAGE) break;
  }
  return all;
}

function rangeParams(select, fromIso, toIso) {
  const q = new URLSearchParams({ select, order: 'id.asc' });
  q.append('yaratilgan', `gte.${fromIso}`);
  q.append('yaratilgan', `lt.${toIso}`);
  return q;
}

// ---------- Umumiy funksiyalar ----------

// Buyurtmani yozadi. Hech qachon xato tashlamaydi: muvaffaqiyatsiz bo'lsa logga yozib false qaytaradi.
async function saveOrder(row) {
  if (usingPostgres) {
    try {
      await pgQuery(
        `insert into ${TABLE} (ism, telefon, izoh, suvlar, jami, rozilik) values ($1, $2, $3, $4::jsonb, $5, $6)`,
        [row.ism, row.telefon, row.izoh ?? null, JSON.stringify(row.suvlar), row.jami, row.rozilik],
      );
      return true;
    } catch (err) {
      console.error('PostgreSQL xatosi:', err.message);
      return false;
    }
  }

  const cfg = supabaseConfig();
  if (!cfg) {
    console.error('Supabase sozlanmagan: SUPABASE_URL yoki SUPABASE_SECRET_KEY yo‘q.');
    return false;
  }
  try {
    const res = await fetch(`${cfg.url}/rest/v1/${TABLE}`, {
      method: 'POST',
      headers: { ...cfg.headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error('Supabase xatosi:', res.status, detail.slice(0, 300));
      return false;
    }
    return true;
  } catch (err) {
    console.error('Supabase tarmoq xatosi:', err.message);
    return false;
  }
}

// [fromIso, toIso) oralig'idagi buyurtmalar soni va jami summasi.
async function todayStats(fromIso, toIso) {
  if (usingPostgres) {
    const { rows } = await pgQuery(
      `select count(*)::int as count, coalesce(sum(jami), 0)::bigint as sum
         from ${TABLE} where yaratilgan >= $1 and yaratilgan < $2`,
      [fromIso, toIso],
    );
    return { count: Number(rows[0].count) || 0, sum: Number(rows[0].sum) || 0 };
  }
  const rows = await supabaseGetAll(rangeParams('jami', fromIso, toIso));
  return { count: rows.length, sum: rows.reduce((s, r) => s + (Number(r.jami) || 0), 0) };
}

// [fromIso, toIso) oralig'idagi buyurtmalar: [{ yaratilgan, jami }] (/hafta uchun).
async function ordersBetween(fromIso, toIso) {
  if (usingPostgres) {
    const { rows } = await pgQuery(
      `select yaratilgan, jami from ${TABLE} where yaratilgan >= $1 and yaratilgan < $2 order by id`,
      [fromIso, toIso],
    );
    return rows;
  }
  return supabaseGetAll(rangeParams('yaratilgan,jami', fromIso, toIso));
}

// Oxirgi buyurtmalar: [{ yaratilgan, ism, telefon, jami }].
async function lastOrders(limit) {
  const n = Math.max(1, Math.min(100, Number(limit) || 10));
  if (usingPostgres) {
    const { rows } = await pgQuery(
      `select yaratilgan, ism, telefon, jami from ${TABLE} order by yaratilgan desc, id desc limit $1`,
      [n],
    );
    return rows;
  }
  const q = new URLSearchParams({ select: 'yaratilgan,ism,telefon,jami', order: 'yaratilgan.desc', limit: String(n) });
  return supabaseGet(q.toString());
}

// ---------- Ko'chirish va zaxira uchun (faqat PostgreSQL) ----------

async function countOrders() {
  const { rows } = await pgQuery(`select count(*)::int as count from ${TABLE}`);
  return Number(rows[0].count) || 0;
}

// Supabase'dagi barcha buyurtmalar (id bo'yicha tartiblangan, sahifalab).
function supabaseAllOrders() {
  return supabaseGetAll(new URLSearchParams({ select: '*', order: 'id.asc' }));
}

// Jadval bo'sh bo'lsagina buyurtmalarni asl id va yaratilgan vaqti bilan yozadi, so'ng id
// ketma-ketligini to'g'rilaydi. Hammasi bitta tranzaksiyada. Natija: { imported } yoki { existing }.
async function importOrders(list) {
  await ensureTable();
  const client = await getPool().connect();
  try {
    await client.query('begin');
    await client.query(`lock table ${TABLE} in exclusive mode`);
    const { rows } = await client.query(`select count(*)::int as count from ${TABLE}`);
    const existing = Number(rows[0].count) || 0;
    if (existing > 0) {
      await client.query('rollback');
      return { existing };
    }

    const COLS = 9;
    const BATCH = 500;
    for (let i = 0; i < list.length; i += BATCH) {
      const chunk = list.slice(i, i + BATCH);
      const params = [];
      const values = chunk.map((r, j) => {
        params.push(
          r.id,
          r.yaratilgan,
          r.ism,
          r.telefon,
          r.izoh ?? null,
          JSON.stringify(r.suvlar ?? []),
          r.jami,
          r.holat === undefined ? 'yangi' : r.holat,
          r.rozilik,
        );
        const b = j * COLS;
        return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}::jsonb, $${b + 7}, $${b + 8}, $${b + 9})`;
      });
      await client.query(
        `insert into ${TABLE} (id, yaratilgan, ism, telefon, izoh, suvlar, jami, holat, rozilik)
         overriding system value values ${values.join(', ')}`,
        params,
      );
    }

    await client.query(
      `select setval(pg_get_serial_sequence($1, 'id'), coalesce(max(id), 1), max(id) is not null) from ${TABLE}`,
      [TABLE],
    );
    await client.query('commit');
    return { imported: list.length };
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  usingPostgres,
  saveOrder,
  todayStats,
  ordersBetween,
  lastOrders,
  countOrders,
  supabaseAllOrders,
  importOrders,
};
