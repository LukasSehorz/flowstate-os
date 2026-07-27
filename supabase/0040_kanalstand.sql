-- =====================================================================
-- Flowstate — Der Kanalstand (Migration 0040)
--
-- ZWEI VERSCHIEDENE ZAHLEN, DIE MAN NICHT VERWECHSELN DARF
--
-- 1) Die Summe unserer erfassten Videos. Rechnet sich aus content_zahlen —
--    dafuer braucht es keine Tabelle, nur einen fehlenden Datumsfilter.
--    Sie sagt: was haben die Videos gebracht, die WIR gemessen haben.
--
-- 2) Der Stand des Kanals. Abonnenten, Gesamtaufrufe, Gesamt-Likes.
--    Den weiss nur die Plattform: er enthaelt aeltere Videos, Inhalte von
--    vor unserer Erfassung, und Zahlen, die dort anders geschnitten sind.
--    Die Summe aus (1) als "Kanalaufrufe" auszugeben waere schlicht falsch —
--    sie liegt immer darunter, und niemand saehe, um wie viel.
--
-- Solange es keinen freigegebenen Plattformzugang gibt, wird (2) von Hand
-- eingetragen — derselbe Weg wie beim Kontostand in der Buchhaltung. Einmal
-- die Woche in die Creator-Ansicht schauen und die Zahl abtippen: zwei Minuten,
-- und die Zahl stimmt. Der Vorteil gegenueber einer gerechneten Schaetzung ist,
-- dass man ihr trauen kann.
--
-- Je Eintrag ein Datum. Aus zwei Eintraegen ergibt sich das Wachstum — das ist
-- der eigentliche Zweck: nicht "wir haben 4.210 Abos", sondern "+310 seit
-- letzter Woche".
-- =====================================================================

create table if not exists public.content_kanalstand (
  id             bigserial primary key,
  marke          uuid not null references public.profiles(id) on delete cascade,
  kanal          text not null,
  gemessen_am    date not null default current_date,

  abonnenten     bigint check (abonnenten     is null or abonnenten     >= 0),
  views_gesamt   bigint check (views_gesamt   is null or views_gesamt   >= 0),
  likes_gesamt   bigint check (likes_gesamt   is null or likes_gesamt   >= 0),
  videos_gesamt  integer check (videos_gesamt is null or videos_gesamt  >= 0),

  notiz          text,
  erfasst_von    uuid references public.profiles(id),
  erstellt       timestamptz not null default now(),

  -- Ein Stand je Kanal und Tag. Zweimal am selben Tag eingetragen heisst
  -- korrigiert, nicht zweimal gewachsen.
  unique (marke, kanal, gemessen_am)
);

create index if not exists content_kanalstand_idx
  on public.content_kanalstand (marke, kanal, gemessen_am desc);

alter table public.content_kanalstand enable row level security;

drop policy if exists content_kanalstand_lesen on public.content_kanalstand;
create policy content_kanalstand_lesen on public.content_kanalstand for select using (true);
drop policy if exists content_kanalstand_schreiben on public.content_kanalstand;
create policy content_kanalstand_schreiben on public.content_kanalstand
  for all using (true) with check (true);

comment on table public.content_kanalstand is
  'Der Stand je Kanal (Abos, Gesamtaufrufe) — von Hand eingetragen, weil kein Plattformzugang besteht. NICHT die Summe unserer Videos.';
