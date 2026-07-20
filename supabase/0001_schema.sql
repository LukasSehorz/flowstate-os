-- =====================================================================
-- Flowstate CRM — Schema (Migration 0001)
-- Umsetzung von Bereich E. Vorbild: Estera CRM.
-- Drei Sparten: webdesign | performance | ki
-- Zwei Pipeline-Ebenen: vertrieb (bis Sale) und projekt (nach Sale)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Nutzer: haengt an Supabase-Auth, traegt die Rolle (E1)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text not null,
  rolle       text not null default 'mitarbeiter' check (rolle in ('admin','mitarbeiter')),
  aktiv       boolean not null default true,
  erstellt    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Konfigurierbare Pipeline-Stufen je Sparte und Art
-- Aenderbar ohne Code — genau wie in Estera (pipeline_stages)
-- ---------------------------------------------------------------------
create table if not exists public.pipeline_stages (
  id          bigserial primary key,
  sparte      text not null check (sparte in ('webdesign','performance','ki')),
  art         text not null check (art in ('vertrieb','projekt')),
  position    int  not null,
  name        text not null,
  ist_abschluss boolean not null default false,   -- "Gewonnen"-Stufe
  unique (sparte, art, position)
);

-- ---------------------------------------------------------------------
-- Firmen = Leads UND Kunden in einer Tabelle (Status entscheidet)
-- ---------------------------------------------------------------------
create table if not exists public.firmen (
  id              bigserial primary key,
  name            text not null,
  status          text not null default 'lead' check (status in ('lead','kunde','verloren','ruht')),
  branche         text,
  website         text,
  telefon         text,
  email           text,
  adresse         text,
  plz             text,
  ort             text,
  quelle          text,          -- cold-call | meta-ads | google-ads | funnel | empfehlung | mail | csv | lead-maschine
  temperatur      text default 'warm' check (temperatur in ('heiss','warm','kalt')),
  score           int,           -- 1-10 aus der Lead-Maschine (Veraltungs-Score)
  argumente       text[],        -- Verkaufsargumente aus der Recherche
  stand           text,          -- E2: der Satz, den man vor dem Anruf wissen muss
  besonderes      text,          -- aus "merk dir ..." (A2)
  versuche        int not null default 0,
  wiedervorlage   date,
  verlust_grund   text,
  tags            text[] default '{}',
  besitzer        uuid references public.profiles(id),
  kunde_seit      date,
  erstellt        timestamptz not null default now(),
  letzte_aktivitaet timestamptz not null default now()
);

create table if not exists public.kontakte (
  id          bigserial primary key,
  firma_id    bigint not null references public.firmen(id) on delete cascade,
  name        text not null,
  funktion    text,             -- Entscheider, Praxismanagement, ...
  email       text,
  telefon     text,
  hinweis     text,             -- "will alles per Mail"
  erstellt    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Deals = Verkaufschancen. Eine Firma kann mehrere haben (KI-Treppe!)
-- ---------------------------------------------------------------------
create table if not exists public.deals (
  id            bigserial primary key,
  firma_id      bigint not null references public.firmen(id) on delete cascade,
  titel         text not null,
  sparte        text not null check (sparte in ('webdesign','performance','ki')),
  stufe_id      bigint references public.pipeline_stages(id),
  wert          numeric(10,2),
  wahrscheinlichkeit int,
  besitzer      uuid references public.profiles(id),
  status        text not null default 'offen' check (status in ('offen','gewonnen','verloren')),
  verlust_grund text,                                   -- E5: Pflicht bei "verloren"
  erwartet_am   date,
  erstellt      timestamptz not null default now(),
  geschlossen_am timestamptz
);

-- ---------------------------------------------------------------------
-- Projekte entstehen aus gewonnenen Deals (Projektpipeline)
-- ---------------------------------------------------------------------
create table if not exists public.projekte (
  id          bigserial primary key,
  firma_id    bigint not null references public.firmen(id) on delete cascade,
  deal_id     bigint references public.deals(id),
  titel       text not null,
  sparte      text not null check (sparte in ('webdesign','performance','ki')),
  stufe_id    bigint references public.pipeline_stages(id),
  besitzer    uuid references public.profiles(id),
  deadline    date,
  status      text not null default 'laeuft' check (status in ('laeuft','pausiert','fertig','abgebrochen')),
  notiz       text,
  erstellt    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Historie: lueckenlos, automatisch (E2)
-- ---------------------------------------------------------------------
create table if not exists public.aktivitaeten (
  id          bigserial primary key,
  firma_id    bigint references public.firmen(id) on delete cascade,
  deal_id     bigint references public.deals(id) on delete cascade,
  projekt_id  bigint references public.projekte(id) on delete cascade,
  wer         uuid references public.profiles(id),
  art         text not null,   -- anruf | mail | notiz | termin | stufenwechsel | uebergabe | system
  text        text,
  zeit        timestamptz not null default now()
);

create table if not exists public.aufgaben (
  id          bigserial primary key,
  firma_id    bigint references public.firmen(id) on delete cascade,
  projekt_id  bigint references public.projekte(id) on delete cascade,
  titel       text not null,
  faellig     date,
  erledigt    boolean not null default false,
  besitzer    uuid references public.profiles(id),
  erstellt    timestamptz not null default now()
);

create table if not exists public.dokumente (
  id          bigserial primary key,
  firma_id    bigint not null references public.firmen(id) on delete cascade,
  name        text not null,
  pfad        text not null,          -- Pfad im Supabase-Storage
  art         text,                   -- vertrag | briefing | logo | zugang | sonstiges
  groesse     bigint,
  hochgeladen_von uuid references public.profiles(id),
  erstellt    timestamptz not null default now()
);

-- Call-Listen (E4)
create table if not exists public.call_listen (
  id          bigserial primary key,
  name        text not null,          -- "Physiotherapie München Juli"
  besitzer    uuid references public.profiles(id),
  erstellt    timestamptz not null default now()
);

create table if not exists public.call_listen_eintraege (
  liste_id    bigint not null references public.call_listen(id) on delete cascade,
  firma_id    bigint not null references public.firmen(id) on delete cascade,
  erledigt    boolean not null default false,
  primary key (liste_id, firma_id)
);

-- Indizes
create index if not exists idx_firmen_besitzer on public.firmen(besitzer);
create index if not exists idx_firmen_status on public.firmen(status);
create index if not exists idx_firmen_wiedervorlage on public.firmen(wiedervorlage);
create index if not exists idx_deals_firma on public.deals(firma_id);
create index if not exists idx_deals_besitzer on public.deals(besitzer);
create index if not exists idx_akt_firma on public.aktivitaeten(firma_id);

-- ---------------------------------------------------------------------
-- Startdaten: die Pipeline-Stufen aus dem Bauplan (frei aenderbar)
-- ---------------------------------------------------------------------
insert into public.pipeline_stages (sparte, art, position, name, ist_abschluss) values
  -- Webdesign — Vertrieb
  ('webdesign','vertrieb',1,'Neu',false),
  ('webdesign','vertrieb',2,'Kontaktiert',false),
  ('webdesign','vertrieb',3,'Erstgespräch',false),
  ('webdesign','vertrieb',4,'Angebot',false),
  ('webdesign','vertrieb',5,'Gewonnen',true),
  -- Webdesign — Projekt
  ('webdesign','projekt',1,'Onboarding & Briefing',false),
  ('webdesign','projekt',2,'Design',false),
  ('webdesign','projekt',3,'Umsetzung',false),
  ('webdesign','projekt',4,'Kundenfreigabe',false),
  ('webdesign','projekt',5,'Live',false),
  ('webdesign','projekt',6,'Wartung',false),
  -- Performance Marketing — Vertrieb
  ('performance','vertrieb',1,'Neu',false),
  ('performance','vertrieb',2,'Kontaktiert',false),
  ('performance','vertrieb',3,'Erstgespräch',false),
  ('performance','vertrieb',4,'Analyse & Strategie',false),
  ('performance','vertrieb',5,'Angebot',false),
  ('performance','vertrieb',6,'Gewonnen',true),
  -- Performance Marketing — Projekt
  ('performance','projekt',1,'Onboarding',false),
  ('performance','projekt',2,'Setup (Konten, Tracking)',false),
  ('performance','projekt',3,'Creatives',false),
  ('performance','projekt',4,'Kampagne live',false),
  ('performance','projekt',5,'Optimierung',false),
  ('performance','projekt',6,'Reporting',false),
  -- KI — Vertrieb (die Treppe)
  ('ki','vertrieb',1,'Neu',false),
  ('ki','vertrieb',2,'Readiness-Check gebucht',false),
  ('ki','vertrieb',3,'Check gehalten',false),
  ('ki','vertrieb',4,'Report versendet',false),
  ('ki','vertrieb',5,'Angebot',false),
  ('ki','vertrieb',6,'Gewonnen',true),
  -- KI — Projekt
  ('ki','projekt',1,'Audit läuft',false),
  ('ki','projekt',2,'Fahrplan & Report',false),
  ('ki','projekt',3,'Pilot läuft',false),
  ('ki','projekt',4,'Übergabe',false),
  ('ki','projekt',5,'Großprojekt',false)
on conflict (sparte, art, position) do nothing;
