// Botni sozlovchi Netlify funksiyasi. Brauzerda ochilganda:
//   1) webhook'ni so'rov kelgan saytdagi /.netlify/functions/telegram ga o'rnatadi
//      (maxfiy belgi bilan — bot tokenining sha256 xeshidan birinchi 32 belgi);
//   2) egasi chati (TELEGRAM_CHAT_ID) uchun buyruqlar ro'yxatini sozlaydi;
//   3) «Menyu» tugmasini shu saytni Telegram Mini App sifatida ochadigan qiladi.
// Natija o'zbek tilida ko'rsatiladi. Token sahifada hech qachon ko'rsatilmaydi.

const crypto = require('crypto');

const COMMANDS = [
  { command: 'start', description: 'Buyruqlar ro‘yxati' },
  { command: 'bugun', description: 'Bugungi buyurtmalar soni va jami summasi' },
  { command: 'buyurtmalar', description: 'Oxirgi 10 ta buyurtma' },
];

const env = (name, legacy) => process.env[name] || process.env[legacy] || '';
const secretFor = (token) => crypto.createHash('sha256').update(token).digest('hex').slice(0, 32);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function page(title, rows, note) {
  const items = rows.map((r) =>
    `<li class="${r.ok ? 'ok' : 'err'}"><b>${r.ok ? '✅' : '❌'} ${esc(r.title)}</b>${r.detail ? `<span>${esc(r.detail)}</span>` : ''}</li>`).join('');
  const html = `<!doctype html>
<html lang="uz"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>
body{margin:0;padding:24px 16px;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#F4F8FC;color:#0A2C5E}
main{max-width:640px;margin:0 auto;background:#fff;border-radius:16px;padding:24px;box-shadow:0 6px 24px rgba(10,44,94,.08)}
h1{margin:0 0 16px;font-size:1.4rem}ul{list-style:none;margin:0;padding:0}
li{padding:12px 14px;border-radius:12px;margin-bottom:10px;background:#EAF7EF}li.err{background:#FDECEC}
li span{display:block;margin-top:4px;font-size:.92rem;color:#4A5B75;word-break:break-word}
p{color:#4A5B75;line-height:1.5}
</style></head><body><main><h1>${esc(title)}</h1><ul>${items}</ul>${note ? `<p>${esc(note)}</p>` : ''}</main></body></html>`;
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
    body: html,
  };
}

function siteOrigin(event) {
  const h = event.headers || {};
  try {
    if (event.rawUrl) return new URL(event.rawUrl).origin;
  } catch { /* pastdagi usul */ }
  const host = h['x-forwarded-host'] || h.host;
  return host ? `https://${host}` : '';
}

exports.handler = async (event) => {
  const token = env('TELEGRAM_BOT_TOKEN', 'Telegram_Bot_Token');
  const ownerChat = env('TELEGRAM_CHAT_ID', 'Telegram_Chat_ID');
  const hide = (s) => String(s || '').split(token).join('***');

  if (!token) {
    return page('Telegram botni sozlash', [{ ok: false, title: 'TELEGRAM_BOT_TOKEN topilmadi', detail: 'Netlify → Site configuration → Environment variables bo‘limida qo‘shing va saytni qayta joylang.' }]);
  }

  const origin = siteOrigin(event);
  if (!origin.startsWith('https://')) {
    return page('Telegram botni sozlash', [{ ok: false, title: 'Sayt manzili HTTPS emas', detail: 'Telegram faqat HTTPS manzillarni qabul qiladi.' }]);
  }
  const webhookUrl = `${origin}/.netlify/functions/telegram`;
  const appUrl = `${origin}/`;

  async function call(method, payload) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {}),
        signal: AbortSignal.timeout(8000),
      });
      const out = await res.json().catch(() => ({}));
      return { ok: !!out.ok, result: out.result, error: hide(out.description || `HTTP ${res.status}`) };
    } catch (err) {
      return { ok: false, error: hide(err.message) };
    }
  }

  const rows = [];

  const me = await call('getMe');
  rows.push(me.ok
    ? { ok: true, title: 'Bot topildi', detail: `@${me.result.username}` }
    : { ok: false, title: 'Bot tokeni noto‘g‘ri yoki Telegram javob bermadi', detail: me.error });
  if (!me.ok) return page('Telegram botni sozlash', rows);

  const hook = await call('setWebhook', {
    url: webhookUrl,
    secret_token: secretFor(token),
    allowed_updates: ['message'],
  });
  rows.push(hook.ok
    ? { ok: true, title: 'Webhook o‘rnatildi', detail: webhookUrl }
    : { ok: false, title: 'Webhook o‘rnatilmadi', detail: hook.error });

  // Buyruqlar faqat egasi chatida ko'rinadi; boshqalar uchun umumiy ro'yxat tozalanadi.
  await call('deleteMyCommands', {});
  if (ownerChat) {
    const cmds = await call('setMyCommands', { commands: COMMANDS, scope: { type: 'chat', chat_id: ownerChat } });
    rows.push(cmds.ok
      ? { ok: true, title: 'Buyruqlar ro‘yxati sozlandi', detail: COMMANDS.map((c) => `/${c.command}`).join(', ') }
      : { ok: false, title: 'Buyruqlar ro‘yxati sozlanmadi', detail: cmds.error });
  } else {
    rows.push({ ok: false, title: 'TELEGRAM_CHAT_ID topilmadi', detail: 'Buyruqlar ro‘yxati sozlanmadi va bot hech kimga buyurtma ma’lumotini bermaydi.' });
  }

  const menu = await call('setChatMenuButton', {
    menu_button: { type: 'web_app', text: 'Menyu', web_app: { url: appUrl } },
  });
  rows.push(menu.ok
    ? { ok: true, title: '«Menyu» tugmasi sozlandi', detail: `Mini App: ${appUrl}` }
    : { ok: false, title: '«Menyu» tugmasi sozlanmadi', detail: menu.error });

  const allOk = rows.every((r) => r.ok);
  return page(
    allOk ? 'Telegram bot muvaffaqiyatli sozlandi' : 'Telegram botni sozlashda xatolik bor',
    rows,
    allOk ? 'Endi botga /start deb yozib tekshirib ko‘ring. Bu sahifani faqat sayt manzili o‘zgarganda qayta ochish kerak.' : 'Xatolarni tuzatib, sahifani qayta oching.',
  );
};
