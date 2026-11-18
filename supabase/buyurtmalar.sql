-- Supabase → SQL Editor'da bir marta ishga tushiring.
create table if not exists public.buyurtmalar (
  id         bigint generated always as identity primary key,
  yaratilgan timestamptz not null default now(),
  ism        text    not null,
  telefon    text    not null,
  izoh       text,
  taomlar    jsonb   not null,          -- [{ nomi, miqdor, narx, summa }]
  jami       integer not null check (jami >= 0),
  rozilik    boolean not null check (rozilik)
);

-- RLS yoqilgan, ochiq siyosat yo'q: jadvalga faqat server (SUPABASE_SECRET_KEY) yozadi va o'qiydi.
alter table public.buyurtmalar enable row level security;

-- Maxfiylik siyosatidagi 1 yillik saqlash muddati uchun (qo'lda yoki pg_cron orqali):
-- delete from public.buyurtmalar where yaratilgan < now() - interval '1 year';
