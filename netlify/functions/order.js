// Buyurtmani Telegram'ga yuboruvchi Netlify funksiyasi.
// Bot tokeni va chat ID faqat Netlify muhit o'zgaruvchilaridan olinadi:
//   Telegram_Bot_Token, Telegram_Chat_ID

// Narxlar serverda saqlanadi — mijoz yuborgan summaga ishonilmaydi.
const PRODUCTS = {
  '5': { name: '5 L ichimlik suvi', price: 7000 },
  '10': { name: '10 L ichimlik suvi', price: 11000 },
  '19': { name: '19 L ichimlik suvi', price: 12000 },
};
const MAX_BODY = 4000;
const MAX_QTY = 100;
const RATE_WINDOW = 60 * 1000;
const RATE_MAX = 3;

// Oddiy IP bo'yicha cheklov (funksiya "issiq" turgan vaqtda ishlaydi).
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 1000) hits.clear();
  return list.length > RATE_MAX;
}

const json = (status, data) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify(data),
});

const clean = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
const som = (n) => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' so‘m';

function phoneOk(v) {
  const d = v.replace(/\D/g, '');
  return /^[+\d\s()\-]+$/.test(v) && (d.length === 9 || (d.length === 12 && d.startsWith('998')));
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Faqat POST so‘rov qabul qilinadi.' });

  const token = process.env.Telegram_Bot_Token;
  const chatId = process.env.Telegram_Chat_ID;
  if (!token || !chatId) return json(500, { ok: false, error: 'Server sozlanmagan.' });

  const raw = event.body || '';
  if (!raw || raw.length > MAX_BODY) return json(400, { ok: false, error: 'So‘rov noto‘g‘ri.' });

  let data;
  try {
    data = JSON.parse(event.isBase64Encoded ? Buffer.from(raw, 'base64').toString('utf8') : raw);
  } catch {
    return json(400, { ok: false, error: 'So‘rov noto‘g‘ri.' });
  }

  // Spamdan himoya: yashirin maydon to'ldirilgan yoki forma juda tez yuborilgan
  if (data.website || !(Number(data.elapsed) >= 3000)) {
    return json(400, { ok: false, error: 'So‘rov rad etildi.' });
  }

  const ip = event.headers['x-nf-client-connection-ip'] || event.headers['x-forwarded-for'] || 'noma’lum';
  if (rateLimited(ip)) return json(429, { ok: false, error: 'Juda ko‘p so‘rov. Birozdan so‘ng urinib ko‘ring.' });

  const name = clean(data.name);
  const phone = clean(data.phone);
  const note = clean(data.note);
  if (name.length < 2 || name.length > 60) return json(400, { ok: false, error: 'Ism noto‘g‘ri.' });
  if (!phoneOk(phone)) return json(400, { ok: false, error: 'Telefon raqami noto‘g‘ri.' });
  if (note.length > 300) return json(400, { ok: false, error: 'Izoh juda uzun.' });

  if (!Array.isArray(data.items) || !data.items.length || data.items.length > 3) {
    return json(400, { ok: false, error: 'Savat bo‘sh.' });
  }
  const seen = new Set();
  const lines = [];
  let total = 0;
  for (const it of data.items) {
    const p = PRODUCTS[it && it.id];
    const qty = Number(it && it.qty);
    if (!p || seen.has(it.id) || !Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
      return json(400, { ok: false, error: 'Savat noto‘g‘ri.' });
    }
    seen.add(it.id);
    const sum = qty * p.price;
    total += sum;
    lines.push(`• ${p.name} — ${qty} dona × ${som(p.price)} = ${som(sum)}`);
  }

  const text = [
    '🆕 Yangi buyurtma (Aqualife-Denov)',
    '',
    ...lines,
    '',
    `💰 Jami summa: ${som(total)}`,
    '',
    `👤 Ism: ${name}`,
    `📞 Telefon: ${phone}`,
    `📍 Manzil / izoh: ${note || '—'}`,
  ].join('\n');

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || !out.ok) {
      console.error('Telegram xatosi:', res.status, out.description);
      return json(502, { ok: false, error: 'Telegram’ga yuborib bo‘lmadi.' });
    }
  } catch (err) {
    console.error('Tarmoq xatosi:', err.message);
    return json(502, { ok: false, error: 'Telegram’ga yuborib bo‘lmadi.' });
  }

  return json(200, { ok: true });
};
