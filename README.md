# Aqualife-Denov 
Сурхондаре буйлаб ичимлик сувларини етказиш.
Муаммо: Мижозлар телефонда буюртма беришга кийналади.
Ечим: сайт оркали 1 дакикада буюртма бериш.

## cPanel hostingga joylash (Node.js)

Sayt Netlify'da ham ishlashda davom etadi. Hostingda esa `server.js` statik sahifalarni beradi va `/.netlify/functions/order`, `telegram`, `telegram-setup` so'rovlarini `netlify/functions/` dagi funksiyalarga uzatadi.

**Node.js ilovani sozlash** (cPanel → *Setup Node.js App* → *Create Application*):

| Maydon | Qiymat |
| --- | --- |
| Node.js version | 22 |
| Application mode | Production |
| Application root | `akvalife-app` |
| Application startup file | `server.js` |

**Muhit o'zgaruvchilari** (shu sahifadagi *Environment variables* bo'limida):

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`

O'zgaruvchilarni qo'shgach, *Restart* tugmasini bosing.

**Avtomatik yuklash:** `main` ga har push bo'lganda GitHub Actions (*Hostingga yuklash*) fayllarni FTPS orqali yuklaydi va `tmp/restart.txt` orqali ilovani qayta ishga tushiradi. GitHub → *Settings → Secrets and variables → Actions* bo'limida `FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD` sirlarini qo'shing (FTP hisobi papkasi ilova papkasiga — `akvalife-app` — qaragan bo'lishi kerak).

## Buyurtmalar bazasi: hostingdagi PostgreSQL

Hostingda buyurtmalar cPanel'dagi PostgreSQL bazasiga yoziladi. Netlify'da (zaxira sayt) `PGDATABASE` yo'q, shuning uchun u Supabase bilan ishlashda davom etadi. Baza kodi — `netlify/lib/db.js`; jadval birinchi ulanishda o'zi yaratiladi.

1. cPanel → *PostgreSQL Databases*: baza va foydalanuvchi yarating, foydalanuvchini bazaga qo'shing.
2. *Setup Node.js App* → *Environment variables* ga qo'shing (mavjudlariga qo'shimcha):
   - `PGHOST` = `localhost`
   - `PGDATABASE` — baza nomi
   - `PGUSER` — foydalanuvchi nomi
   - `PGPASSWORD` — foydalanuvchi paroli
3. Shu sahifada **«Установить NPM пакеты»** (*Run NPM Install*) tugmasini bosing (`pg` paketi o'rnatiladi), so'ng *Restart*.
4. **Ko'chirish:** brauzerda `https://DOMEN/.netlify/functions/kochirish` ni bir marta oching. Jadval bo'sh bo'lsa, Supabase'dagi barcha buyurtmalar ko'chiriladi (buning uchun `SUPABASE_URL` va `SUPABASE_SECRET_KEY` hali turgan bo'lishi kerak). Jadvalda buyurtma bo'lsa, sahifa hech narsa qilmaydi.

**Kunlik zaxira** (cPanel → *Cron Jobs*, har kuni 03:00):

```
0 3 * * * curl -s https://DOMEN/.netlify/functions/zaxira > /dev/null
```

Zaxira `~/zaxira/buyurtmalar-YYYY-MM-DD.sql.gz` ga saqlanadi va Telegram'ga (`TELEGRAM_CHAT_ID`) yuboriladi; 14 kundan eskilari o'chiriladi. Kuniga bir martadan ko'p olinmaydi.

**Zaxiradan tiklash** (cPanel → *Terminal*):

```
gunzip -c buyurtmalar-YYYY-MM-DD.sql.gz | psql -h localhost -U FOYDALANUVCHI BAZA
```
