-- =====================================================================
-- Flowstate — Ein Stück Content, mehrere Kanäle (Migration 0030)
--
-- DER PUNKT, UM DEN ES GEHT
--
-- Janniks Woche sieht so aus:
--   14 Kurzvideos  -> gehen auf TikTok, YouTube (Shorts) UND Instagram (Reels).
--                     Es sind DIESELBEN Videos, nicht 42 verschiedene.
--    1 Langvideo   -> nur YouTube
--    7 Beitraege   -> nur X
--
-- Bisher hatte ein Post genau einen Kanal. Ein Kurzvideo haette also dreimal
-- eingetragen werden muessen — dreifache Pflege fuer eine Sache, und beim
-- Aendern des Titels laufen die drei Zeilen auseinander.
--
-- Darum: kanal (ein Text) wird zu kanaele (eine Liste). Ein Post ist ein STUeCK
-- Content; die Liste sagt, wo es hingeht.
--
-- WOCHENZIELE JE KANAL
--
-- Das eine Ziel fuer alles reichte nicht mehr — die Zahlen sind je Kanal
-- verschieden (YouTube 15, TikTok 14, Instagram 14, X 7) und je Marke auch.
-- content_ziele haelt darum ein Ziel pro Marke UND Kanal.
--
-- content_einstellungen.posts_ziel_woche bleibt als Rueckfallwert fuer Marken,
-- fuer die noch nichts eingetragen ist.
--
-- Der Umbau ist gefahrlos: content_posts hat null Zeilen. Waeren echte Belege
-- drin, muesste kanal stehen bleiben statt zu verschwinden.
-- =====================================================================

-- ------------------------------------------------------ 1) Mehrere Kanaele

alter table public.content_posts
  add column if not exists kanaele text[] not null default '{}';

-- Bestand uebernehmen, falls doch etwas drinsteht.
update public.content_posts
   set kanaele = array[kanal]
 where kanal is not null and cardinality(kanaele) = 0;

-- Ein Post ohne Kanal waere ein Post, der nirgends erscheint.
alter table public.content_posts drop constraint if exists content_posts_kanaele_check;
alter table public.content_posts add constraint content_posts_kanaele_check
  check (cardinality(kanaele) > 0);

drop index if exists content_posts_kanal_idx;
create index if not exists content_posts_kanaele_idx
  on public.content_posts using gin (kanaele);

alter table public.content_posts drop column if exists kanal;

-- "format" hiess der Beitragstyp, war aber je Kanal verschieden (Reel hier,
-- Kurzvideo dort). Jetzt beschreibt "sorte" das Stueck selbst — unabhaengig
-- davon, wo es erscheint.
alter table public.content_posts rename column format to sorte;

-- ------------------------------------------------------ 2) Ziele je Kanal

create table if not exists public.content_ziele (
  id            bigserial primary key,
  marke         uuid not null references public.profiles(id) on delete cascade,
  kanal         text not null,
  ziel          integer not null default 0 check (ziel >= 0 and ziel <= 500),
  geaendert_von uuid references public.profiles(id),
  geaendert     timestamptz not null default now(),
  unique (marke, kanal)
);

alter table public.content_ziele enable row level security;

drop policy if exists content_ziele_lesen on public.content_ziele;
create policy content_ziele_lesen on public.content_ziele for select using (true);
drop policy if exists content_ziele_schreiben on public.content_ziele;
create policy content_ziele_schreiben on public.content_ziele
  for all using (public.ist_admin()) with check (public.ist_admin());

-- Janniks Woche, wie am 26.07. festgelegt. Lukas bekommt bewusst keine Zeile —
-- er faengt spaeter an, und eine 0 als Ziel waere etwas anderes als "noch nicht
-- festgelegt".
insert into public.content_ziele (marke, kanal, ziel)
select p.id, z.kanal, z.ziel
  from public.profiles p
  join (values ('YouTube', 15), ('TikTok', 14), ('Instagram', 14), ('X', 7))
       as z(kanal, ziel) on true
 where p.name = 'Jannik vom Hofe'
on conflict (marke, kanal) do nothing;

comment on table public.content_ziele is
  'Wochenziel je Marke und Kanal. Keine Zeile = noch nicht festgelegt (nicht: Ziel null).';
comment on column public.content_posts.kanaele is
  'Alle Kanäle, auf denen dieses eine Stück erscheint. Ein Kurzvideo läuft auf TikTok, YouTube und Instagram — dieselbe Datei, ein Eintrag.';
