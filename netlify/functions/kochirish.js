// Buyurtmalarni Supabase'dan hostingdagi PostgreSQL'ga bir martalik ko'chirish sahifasi.
// Brauzerda ochilganda:
//   - PGDATABASE yo'q bo'lsa (masalan Netlify'da) — hech narsa qilmaydi;
//   - hosting jadvalida buyurtma bo'lsa — hech narsa qilmaydi;
//   - jadval bo'sh bo'lsa — Supabase'dagi barcha buyurtmalarni (1000 tadan sahifalab) asl id va
//     yaratilgan vaqti bilan ko'chiradi va id ketma-ketligini to'g'rilaydi.
// Shuning uchun sahifani qayta ochish xavfsiz — maxfiy kalit kerak emas.

'use strict';

const db = require('../lib/db');

const TITLE = 'Buyurtmalarni ko‘chirish';
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function page(kind, title, detail) {
  const html = `<!doctype html>
<html lang="uz"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(TITLE)}</title>
<style>
body{margin:0;padding:24px 16px;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#F4F8FC;color:#0A2C5E}
main{max-width:640px;margin:0 auto;background:#fff;border-radius:16px;padding:24px;box-shadow:0 6px 24px rgba(10,44,94,.08)}
h1{margin:0 0 16px;font-size:1.4rem}ul{list-style:none;margin:0;padding:0}
li{padding:12px 14px;border-radius:12px;margin-bottom:10px;background:#EAF7EF}li.err{background:#FDECEC}li.info{background:#EEF3FA}
li span{display:block;margin-top:4px;font-size:.92rem;color:#4A5B75;word-break:break-word}
</style></head><body><main><h1>${esc(TITLE)}</h1><ul><li class="${kind}"><b>${esc(title)}</b>${detail ? `<span>${esc(detail)}</span>` : ''}</li></ul></main></body></html>`;
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
    body: html,
  };
}

exports.handler = async () => {
  if (!process.env.PGDATABASE) {
    return page('info', 'ℹ️ Bu sahifa faqat hostingda ishlaydi');
  }
  if (!db.usingPostgres) {
    return page('err', '❌ "pg" paketi o‘rnatilmagan', 'cPanel → Setup Node.js App → «Установить NPM пакеты» tugmasini bosing va ilovani qayta ishga tushiring.');
  }

  try {
    const existing = await db.countOrders();
    if (existing > 0) {
      return page('info', `ℹ️ Jadvalda allaqachon ${existing} ta buyurtma bor`, 'Hech narsa ko‘chirilmadi.');
    }

    let orders;
    try {
      orders = await db.supabaseAllOrders();
    } catch (err) {
      console.error('Ko‘chirish: Supabase xatosi:', err.message);
      return page('err', '❌ Supabase’dan buyurtmalarni olib bo‘lmadi', 'SUPABASE_URL va SUPABASE_SECRET_KEY muhit o‘zgaruvchilarini tekshiring.');
    }

    const result = await db.importOrders(orders);
    if (result.existing) {
      return page('info', `ℹ️ Jadvalda allaqachon ${result.existing} ta buyurtma bor`, 'Hech narsa ko‘chirilmadi.');
    }
    return page('ok', `✅ ${result.imported} ta buyurtma ko‘chirildi`);
  } catch (err) {
    console.error('Ko‘chirish xatosi:', err.message);
    return page('err', '❌ Ko‘chirishda xatolik', 'Hech narsa o‘zgartirilmadi. Batafsil ma’lumot server logida.');
  }
};
