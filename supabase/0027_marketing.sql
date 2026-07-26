-- =====================================================================
-- Flowstate — Marketing & Content (Migration 0027)
--
-- Baut den Bereich, der bisher nur als Platzhalter dastand. Der Zuschnitt kommt
-- aus der Beschreibung in server.js:
--   "Redaktionsplan, Social-Posts (Masse schlaegt Qualitaet), Kampagnen-Zahlen,
--    Funnel-Uebersicht (Zahnaerzte, Physios)."
--
-- Daraus werden zwei Tabellenpaare und eine Rechnung ohne eigene Tabelle:
--
--   content_posts       Redaktionsplan UND Massen-Zaehler in einem. Ein Post ist
--                       eine Zeile, die von "Idee" bis "veroeffentlicht" wandert.
--                       Zwei getrennte Tabellen waeren doppelte Pflege gewesen:
--                       der Plan von heute ist die Statistik von naechster Woche.
--
--   kampagnen           Was an bezahlter Werbung laeuft (Meta, Google, LinkedIn).
--   kampagnen_zahlen    Die Zahlen dazu, je Kampagne und Monat von Hand
--                       eingetragen. Bewusst getrennt von der Kampagne: eine
--                       Kampagne laeuft ueber Monate, die Zahlen kommen monatlich
--                       dazu — und eine korrigierte Zahl darf die Kampagne nicht
--                       anfassen muessen.
--
--   Funnel              Braucht KEINE eigene Tabelle. Woher ein Kunde kam
--                       (firmen.quelle), aus welcher Branche er ist
--                       (firmen.branche) und wie weit er gekommen ist, steht
--                       bereits im CRM. Alles doppelt zu fuehren hiesse, dass es
--                       frueher oder spaeter auseinanderlaeuft.
--
-- ZIELE: "Masse schlaegt Qualitaet" braucht eine Zahl, gegen die gemessen wird.
-- Die steht in marketing_einstellungen und ist aenderbar, statt im Code zu
-- stecken.
-- =====================================================================

-- ------------------------------------------------------------ Redaktionsplan

create table if not exists public.content_posts (
  id               bigserial primary key,
  titel            text not null,              -- Thema oder Aufhaenger
  kanal            text not null,              -- Instagram, LinkedIn, TikTok, ...
  format           text,                       -- Reel, Karussell, Text, Video, ...
  status           text not null default 'idee'
                     check (status in ('idee', 'entwurf', 'geplant', 'veroeffentlicht')),
  geplant_am       date,                       -- wann es rausgehen soll
  veroeffentlicht_am date,                     -- wann es tatsaechlich rausging
  sparte           text,                       -- webdesign | performance | ki | allgemein
  zielgruppe       text,                       -- Physiotherapie, Zahnaerzte, ...
  besitzer         uuid references public.profiles(id),
  link             text,                       -- URL nach der Veroeffentlichung
  notiz            text,
  erstellt         timestamptz not null default now()
);

create index if not exists content_posts_plan_idx   on public.content_posts (geplant_am);
create index if not exists content_posts_raus_idx   on public.content_posts (veroeffentlicht_am desc);
create index if not exists content_posts_status_idx on public.content_posts (status, geplant_am);

-- ----------------------------------------------------------------- Kampagnen

create table if not exists public.kampagnen (
  id           bigserial primary key,
  name         text not null,
  kanal        text not null,                  -- Meta Ads, Google Ads, LinkedIn Ads
  zielgruppe   text,                           -- Physiotherapie, Zahnaerzte
  sparte       text,
  status       text not null default 'laeuft'
                 check (status in ('geplant', 'laeuft', 'pausiert', 'beendet')),
  start_am     date,
  ende_am      date,
  budget       numeric(12,2),                  -- geplantes Gesamtbudget
  besitzer     uuid references public.profiles(id),
  notiz        text,
  erstellt     timestamptz not null default now()
);

create index if not exists kampagnen_status_idx on public.kampagnen (status, start_am desc);

-- Zahlen je Kampagne und Monat. datum ist immer der Monatserste — so kann eine
-- Zahl nachtraeglich korrigiert werden, ohne dass ein zweiter Eintrag entsteht.
create table if not exists public.kampagnen_zahlen (
  id            bigserial primary key,
  kampagne_id   bigint not null references public.kampagnen(id) on delete cascade,
  datum         date not null,
  ausgaben      numeric(12,2) not null default 0,
  impressionen  bigint not null default 0,
  klicks        bigint not null default 0,
  leads         integer not null default 0,
  notiz         text,
  erfasst_von   uuid references public.profiles(id),
  erstellt      timestamptz not null default now(),
  unique (kampagne_id, datum)
);

create index if not exists kampagnen_zahlen_zeit_idx on public.kampagnen_zahlen (datum desc);

-- --------------------------------------------------------------- Einstellungen

create table if not exists public.marketing_einstellungen (
  id                smallint primary key default 1 check (id = 1),
  posts_ziel_woche  integer not null default 20,
  geaendert_von     uuid references public.profiles(id),
  geaendert         timestamptz not null default now()
);

insert into public.marketing_einstellungen (id) values (1) on conflict (id) do nothing;

-- ------------------------------------------------------------------- Zugriff
--
-- Anders als die Buchhaltung ist Marketing Teamarbeit: Content planen und
-- abhaken macht nicht nur die Geschaeftsfuehrung. Darum sehen und pflegen alle
-- angemeldeten Personen die Inhalte. Geloescht wird nur, was einem selbst
-- gehoert — oder von einem Admin.

alter table public.content_posts          enable row level security;
alter table public.kampagnen              enable row level security;
alter table public.kampagnen_zahlen       enable row level security;
alter table public.marketing_einstellungen enable row level security;

drop policy if exists content_posts_lesen on public.content_posts;
create policy content_posts_lesen on public.content_posts for select using (true);
drop policy if exists content_posts_schreiben on public.content_posts;
create policy content_posts_schreiben on public.content_posts for insert with check (true);
drop policy if exists content_posts_aendern on public.content_posts;
create policy content_posts_aendern on public.content_posts for update using (true) with check (true);
drop policy if exists content_posts_loeschen on public.content_posts;
create policy content_posts_loeschen on public.content_posts
  for delete using (public.ist_admin() or besitzer = auth.uid() or besitzer is null);

drop policy if exists kampagnen_lesen on public.kampagnen;
create policy kampagnen_lesen on public.kampagnen for select using (true);
drop policy if exists kampagnen_schreiben on public.kampagnen;
create policy kampagnen_schreiben on public.kampagnen for insert with check (true);
drop policy if exists kampagnen_aendern on public.kampagnen;
create policy kampagnen_aendern on public.kampagnen for update using (true) with check (true);
drop policy if exists kampagnen_loeschen on public.kampagnen;
create policy kampagnen_loeschen on public.kampagnen
  for delete using (public.ist_admin() or besitzer = auth.uid() or besitzer is null);

drop policy if exists kampagnen_zahlen_alle on public.kampagnen_zahlen;
create policy kampagnen_zahlen_alle on public.kampagnen_zahlen
  for all using (true) with check (true);

drop policy if exists marketing_einstellungen_lesen on public.marketing_einstellungen;
create policy marketing_einstellungen_lesen on public.marketing_einstellungen
  for select using (true);
drop policy if exists marketing_einstellungen_aendern on public.marketing_einstellungen;
create policy marketing_einstellungen_aendern on public.marketing_einstellungen
  for update using (public.ist_admin()) with check (public.ist_admin());
