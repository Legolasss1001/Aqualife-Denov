// Kunlik zaxira (cron uchun): hostingdagi PostgreSQL bazasidan pg_dump bilan nusxa olib,
// gzip qiladi, ~/zaxira/buyurtmalar-YYYY-MM-DD.sql.gz ga saqlaydi (Toshkent sanasi),
// 14 kundan eski zaxiralarni o'chiradi va faylni Telegram orqali TELEGRAM_CHAT_ID ga yuboradi.
// Bugungi zaxira allaqachon bo'lsa, qayta olmaydi — shuning uchun maxfiy kalit kerak emas.
// Ulanish PG* muhit o'zgaruvchilaridan olinadi; parol buyruq qatoriga yozilmaydi.

'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawn } = require('child_process');
const { pipeline } = require('stream/promises');
const db = require('../lib/db');

const TZ_OFFSET_MS = 5 * 60 * 60 * 1000; // Toshkent: UTC+5
const DAY_MS = 24 * 60 * 60 * 1000;
const KEEP_DAYS = 14;
const DIR = path.join(os.homedir(), 'zaxira');
const FILE_RE = /^buyurtmalar-(\d{4}-\d{2}-\d{2})\.sql\.gz$/;

const env = (name, legacy) => process.env[name] || process.env[legacy] || '';
const pad = (n) => String(n).padStart(2, '0');
const text = (status, body) => ({
  statusCode: status,
  headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
  body,
});

let running = false;

// pg_dump → gzip → fayl. Avval vaqtinchalik faylga yoziladi, muvaffaqiyatli bo'lsa nomi o'zgartiriladi.
async function dumpTo(file) {
  const tmp = `${file}.tmp`;
  const child = spawn('pg_dump', ['--no-owner', '--no-privileges', '--clean', '--if-exists'], {
    env: { ...process.env, PGHOST: process.env.PGHOST || 'localhost' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (d) => { if (stderr.length < 2000) stderr += d; });
  const exited = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });
  try {
    await pipeline(child.stdout, zlib.createGzip({ level: 9 }), fs.createWriteStream(tmp, { mode: 0o600 }));
    const code = await exited;
    if (code !== 0) throw new Error(`pg_dump ${code} kodi bilan tugadi: ${stderr.trim().slice(0, 500)}`);
    await fsp.rename(tmp, file);
  } catch (err) {
    child.kill();
    await fsp.rm(tmp, { force: true });
    throw err;
  }
}

// Fayl nomidagi sana bo'yicha 14 kundan eski zaxiralarni o'chiradi.
async function removeOld(todayUtcMs) {
  const limit = todayUtcMs - KEEP_DAYS * DAY_MS;
  let removed = 0;
  for (const name of await fsp.readdir(DIR)) {
    const m = FILE_RE.exec(name);
    if (m && Date.parse(`${m[1]}T00:00:00Z`) < limit) {
      await fsp.rm(path.join(DIR, name), { force: true });
      removed += 1;
    }
  }
  return removed;
}

async function sendToTelegram(file, caption) {
  const token = env('TELEGRAM_BOT_TOKEN', 'Telegram_Bot_Token');
  const chatId = env('TELEGRAM_CHAT_ID', 'Telegram_Chat_ID');
  if (!token || !chatId) throw new Error('TELEGRAM_BOT_TOKEN yoki TELEGRAM_CHAT_ID yo‘q');
  const form = new FormData();
  form.append('chat_id', chatId);
  form.append('caption', caption);
  form.append('document', new Blob([await fsp.readFile(file)], { type: 'application/gzip' }), path.basename(file));
  const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(60000),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || !out.ok) throw new Error(`Telegram ${res.status}: ${String(out.description || '').split(token).join('***')}`);
}

exports.handler = async () => {
  if (!process.env.PGDATABASE) return text(200, 'Bu sahifa faqat hostingda ishlaydi');
  if (!db.usingPostgres) return text(500, 'Xato: "pg" paketi o‘rnatilmagan');
  if (running) return text(200, 'Zaxira hozir olinmoqda');

  const local = new Date(Date.now() + TZ_OFFSET_MS);
  const todayUtcMs = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const ymd = `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
  const file = path.join(DIR, `buyurtmalar-${ymd}.sql.gz`);

  running = true;
  try {
    await fsp.mkdir(DIR, { recursive: true, mode: 0o700 });
    if (fs.existsSync(file)) return text(200, `${ymd}: bugun zaxira olingan`);

    const count = await db.countOrders();
    await dumpTo(file);
    const removed = await removeOld(todayUtcMs);
    const size = (await fsp.stat(file)).size;

    const caption = `🗄 Kunlik zaxira: ${pad(local.getUTCDate())}.${pad(local.getUTCMonth() + 1)}, ${count} ta buyurtma`;
    const summary = `${ymd}: zaxira olindi (${count} ta buyurtma, ${Math.ceil(size / 1024)} KB), eski fayllar o‘chirildi: ${removed}`;
    try {
      await sendToTelegram(file, caption);
    } catch (err) {
      console.error('Zaxira: Telegram xatosi:', err.message);
      return text(502, `${summary}; Telegram’ga yuborib bo‘lmadi`);
    }
    return text(200, `${summary}; Telegram’ga yuborildi`);
  } catch (err) {
    console.error('Zaxira xatosi:', err.message);
    return text(500, 'Xato: zaxira olinmadi (batafsil server logida)');
  } finally {
    running = false;
  }
};
