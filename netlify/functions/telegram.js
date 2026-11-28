// Telegram bot webhook'i (Netlify funksiyasi).
// Faqat Telegram yuborgan so'rovlar qabul qilinadi: X-Telegram-Bot-Api-Secret-Token
// sarlavhasi bot tokenining sha256 xeshidan olingan birinchi 32 belgiga teng bo'lishi shart.
// Buyurtma ma'lumoti faqat TELEGRAM_CHAT_ID dagi chatga beriladi.
// Sozlamalar faqat Netlify muhit o'zgaruvchilaridan olinadi:
//   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID — Telegram bot
//   Baza — ../lib/db.js ga qarang (hostingda PostgreSQL, Netlify'da Supabase).

const crypto = require('crypto');
const db = require('../lib/db');

const TZ_OFFSET_MS = 5 * 60 * 60 * 1000; // Toshkent: UTC+5, yozgi vaqt yo'q
const MAX_BODY = 100000;

const MENU_TEXT = 'Buyurtma berish uchun pastdagi «Menyu» tugmasini bosing';
const HELP_TEXT = [
  'Aqualife-Denov boti buyruqlari:',
  '',
  '/bugun — bugungi buyurtmalar soni va jami summasi',
  '/hafta — shu haftadagi buyurtmalar soni va jami summasi',
  '/buyurtmalar — oxirgi 10 ta buyurtma',
  '/start — buyruqlar ro‘yxati',
].join('\n');

// Eski nomlar (Telegram_Bot_Token, Telegram_Chat_ID) ham qo'llab-quvvatlanadi.
const env = (name, legacy) => process.env[name] || process.env[legacy] || '';

const secretFor = (token) => crypto.createHash('sha256').update(token).digest('hex').slice(0, 32);

function secretOk(given, token) {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(secretFor(token));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const ok = (reply) => ({
  statusCode: 200,
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  // Javobni webhook javobining o'zida yuboramiz — alohida so'rov kerak emas.
  body: reply ? JSON.stringify({ method: 'sendMessage', disable_web_page_preview: true, ...reply }) : '',
});

const som = (n) => Number(n || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' so‘m';
const pad = (n) => String(n).padStart(2, '0');

// UTC vaqtni Toshkent vaqtida «dd.mm.yyyy hh:mm» ko'rinishida qaytaradi.
function tashkentTime(iso) {
  const d = new Date(new Date(iso).getTime() + TZ_OFFSET_MS);
  if (Number.isNaN(d.getTime())) return '—';
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

// Toshkent bo'yicha bugungi kun chegaralari (UTC ISO ko'rinishida).
function todayRange() {
  const local = new Date(Date.now() + TZ_OFFSET_MS);
  const startUtc = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - TZ_OFFSET_MS;
  return {
    from: new Date(startUtc).toISOString(),
    to: new Date(startUtc + 24 * 60 * 60 * 1000).toISOString(),
    label: `${pad(local.getUTCDate())}.${pad(local.getUTCMonth() + 1)}.${local.getUTCFullYear()}`,
  };
}

async function cmdToday() {
  const { from, to, label } = todayRange();
  const { count, sum } = await db.todayStats(from, to);
  return [
    `📅 Bugun (${label}, Toshkent vaqti):`,
    '',
    `🧾 Buyurtmalar soni: ${count} ta`,
    `💰 Jami summa: ${som(sum)}`,
  ].join('\n');
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba', 'Yakshanba'];
const dateLabel = (d) => `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;

// Shu hafta: Toshkent vaqti bo'yicha dushanba 00:00 dan keyingi dushanba 00:00 gacha.
async function cmdWeek() {
  const local = new Date(Date.now() + TZ_OFFSET_MS);
  const todayStart = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const mondayLocal = todayStart - ((local.getUTCDay() + 6) % 7) * DAY_MS; // 0 = dushanba
  const from = new Date(mondayLocal - TZ_OFFSET_MS).toISOString();
  const to = new Date(mondayLocal + 7 * DAY_MS - TZ_OFFSET_MS).toISOString();

  const days = WEEKDAYS.map((name) => ({ name, count: 0, sum: 0 }));
  let count = 0;
  let sum = 0;
  const rows = await db.ordersBetween(from, to);
  rows.forEach((r) => {
    const jami = Number(r.jami) || 0;
    const idx = Math.floor((new Date(r.yaratilgan).getTime() + TZ_OFFSET_MS - mondayLocal) / DAY_MS);
    if (idx >= 0 && idx < 7) { days[idx].count += 1; days[idx].sum += jami; }
    count += 1;
    sum += jami;
  });

  const lines = [
    `📆 Shu hafta (${dateLabel(new Date(mondayLocal))} – ${dateLabel(new Date(mondayLocal + 6 * DAY_MS))}, Toshkent vaqti):`,
    '',
    `🧾 Buyurtmalar soni: ${count} ta`,
    `💰 Jami summa: ${som(sum)}`,
  ];
  const active = days.filter((d) => d.count);
  if (active.length) {
    lines.push('', 'Kunlar bo‘yicha:');
    active.forEach((d) => lines.push(`• ${d.name}: ${d.count} ta, ${som(d.sum)}`));
  }
  return lines.join('\n');
}

async function cmdLatest() {
  const rows = await db.lastOrders(10);
  if (!rows.length) return 'Hozircha buyurtmalar yo‘q.';
  const lines = ['🧾 Oxirgi 10 ta buyurtma (Toshkent vaqti):', ''];
  rows.forEach((r, i) => {
    lines.push(`${i + 1}. 🕒 ${tashkentTime(r.yaratilgan)}`);
    lines.push(`   👤 ${r.ism || '—'}`);
    lines.push(`   📞 ${r.telefon || '—'}`);
    lines.push(`   💰 ${som(r.jami)}`);
    lines.push('');
  });
  return lines.join('\n').trim();
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: '' };

  const token = env('TELEGRAM_BOT_TOKEN', 'Telegram_Bot_Token');
  const ownerChat = env('TELEGRAM_CHAT_ID', 'Telegram_Chat_ID');
  if (!token || !ownerChat) {
    console.error('Telegram sozlanmagan: TELEGRAM_BOT_TOKEN yoki TELEGRAM_CHAT_ID yo‘q.');
    return { statusCode: 500, body: '' };
  }

  const headers = event.headers || {};
  if (!secretOk(headers['x-telegram-bot-api-secret-token'], token)) {
    return { statusCode: 401, body: '' };
  }

  const raw = event.body || '';
  if (raw.length > MAX_BODY) return ok();
  let update;
  try {
    update = JSON.parse(event.isBase64Encoded ? Buffer.from(raw, 'base64').toString('utf8') : raw);
  } catch {
    return ok();
  }

  const msg = update && update.message;
  if (!msg || !msg.chat) return ok();
  const chatId = msg.chat.id;
  const reply = (text) => ok({ chat_id: chatId, text });

  // Egasidan boshqa har qanday chat — faqat «Menyu» haqida eslatma.
  if (String(chatId) !== String(ownerChat)) return reply(MENU_TEXT);

  const text = typeof msg.text === 'string' ? msg.text.trim() : '';
  const cmd = text.startsWith('/') ? text.split(/\s+/)[0].split('@')[0].toLowerCase() : '';

  if (!cmd) {
    // Guruhda oddiy yozishmalarga javob bermaymiz, shaxsiy chatda — buyruqlar ro'yxati.
    return msg.chat.type === 'private' ? reply(HELP_TEXT) : ok();
  }

  try {
    if (cmd === '/bugun') return reply(await cmdToday());
    if (cmd === '/hafta') return reply(await cmdWeek());
    if (cmd === '/buyurtmalar') return reply(await cmdLatest());
  } catch (err) {
    console.error('Buyruq xatosi:', cmd, err.message);
    return reply('⚠️ Ma’lumotlarni olib bo‘lmadi. Birozdan so‘ng qayta urinib ko‘ring.');
  }
  return reply(HELP_TEXT);
};
