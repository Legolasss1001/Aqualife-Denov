# Aqualife-Denov 
Сурхондаре буйлаб ичимлик сувларини етказиш.
Муаммо: Мижозлар телефонда буюртма беришга кийналади.
Ечим: сайт оркали 1 дакикада буюртма бериш.

## cPanel hostingga joylash (Node.js)

Sayt Netlify'da ham ishlashda davom etadi. Hostingda esa `server.js` statik sahifalarni beradi va `/.netlify/functions/order`, `telegram`, `telegram-setup` so'rovlarini `netlify/functions/` dagi funksiyalarga uzatadi (npm kutubxonalari kerak emas).

**Node.js ilovani sozlash** (cPanel → *Setup Node.js App* → *Create Application*):

| Maydon | Qiymat |
| --- | --- |
| Node.js version | 22 |
| Application mode | Production |
| Application root | `burgersmash-app` |
| Application startup file | `server.js` |

**Muhit o'zgaruvchilari** (shu sahifadagi *Environment variables* bo'limida):

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`

O'zgaruvchilarni qo'shgach, *Restart* tugmasini bosing.

**Avtomatik yuklash:** `main` ga har push bo'lganda GitHub Actions (*Hostingga yuklash*) fayllarni FTPS orqali yuklaydi va `tmp/restart.txt` orqali ilovani qayta ishga tushiradi. GitHub → *Settings → Secrets and variables → Actions* bo'limida `FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD` sirlarini qo'shing (FTP hisobi papkasi ilova papkasiga — `burgersmash-app` — qaragan bo'lishi kerak).
