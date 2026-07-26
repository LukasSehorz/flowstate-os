-- =====================================================================
-- Flowstate CRM — Buchhaltung (Migration 0021)
--
-- Bisher war /buchhaltung eine leere Platzhalterseite. Diese Migration legt
-- die zwei Tabellen an, die der Ueberblick braucht.
--
-- buchungen  Einnahmen und Ausgaben. betrag ist IMMER positiv, die Richtung
--            steckt in art ('einnahme' | 'ausgabe') — so lassen sich Summen
--            ohne Vorzeichenfallen bilden.
--            bezahlt = false + faellig  ->  offene Rechnung
-- belege     Was per Beleg hereinkommt. Ein Beleg kann einer Buchung
--            zugeordnet werden (buchung_id) oder erst einmal offen liegen.
--
-- Buchhaltung sieht nur die Geschaeftsfuehrung: beide Tabellen sind komplett
-- auf ist_admin() beschraenkt, es gibt keinen Besitzer-Zugriff wie bei Leads.
-- =====================================================================

create table if not exists public.buchungen (
  id           bigserial primary key,
  art          text        not null check (art in ('einnahme', 'ausgabe')),
  datum        date        not null default current_date,
  betrag       numeric(12,2) not null check (betrag >= 0),
  kategorie    text,
  gegenstelle  text,                  -- Kunde bei Einnahmen, Empfaenger bei Ausgaben
  notiz        text,
  firma_id     bigint      references public.firmen(id) on delete set null,
  bezahlt      boolean     not null default true,
  faellig      date,
  wiederkehrend boolean    not null default false,
  erfasst_von  uuid        references public.profiles(id),
  erstellt     timestamptz not null default now()
);

create table if not exists public.belege (
  id           bigserial primary key,
  dateiname    text        not null,
  betrag       numeric(12,2),
  datum        date,
  status       text        not null default 'offen' check (status in ('offen', 'zugeordnet')),
  buchung_id   bigint      references public.buchungen(id) on delete set null,
  notiz        text,
  von          uuid        references public.profiles(id),
  erstellt     timestamptz not null default now()
);

create index if not exists buchungen_datum_idx  on public.buchungen (datum desc);
create index if not exists buchungen_offen_idx  on public.buchungen (bezahlt, faellig);
create index if not exists belege_status_idx    on public.belege (status, erstellt desc);

alter table public.buchungen enable row level security;
alter table public.belege    enable row level security;

drop policy if exists buchungen_admin on public.buchungen;
create policy buchungen_admin on public.buchungen
  for all using (public.ist_admin()) with check (public.ist_admin());

drop policy if exists belege_admin on public.belege;
create policy belege_admin on public.belege
  for all using (public.ist_admin()) with check (public.ist_admin());
