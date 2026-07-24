-- =====================================================================
-- Flowstate CRM — Zeiterfassung (Migration 0003)
-- Eine Zeile pro Person und Tag. "sekunden" sammelt sich durch Start/Pause/
-- Feierabend und den Herzschlag aus dem Header (public/... via lib/schale.js).
-- Automatische Pause nach Inaktivitaet ist Anwendungslogik (lib/crm.js),
-- nicht in der DB — die Tabelle speichert nur den Ist-Stand.
-- =====================================================================

create table if not exists public.zeiterfassung (
  id                bigserial primary key,
  nutzer_id         uuid not null references public.profiles(id) on delete cascade,
  datum             date not null,
  sekunden          integer not null default 0,
  status            text not null default 'gestartet' check (status in ('gestartet','pausiert','beendet')),
  letzte_aktivitaet timestamptz not null default now(),
  erstellt          timestamptz not null default now(),
  unique (nutzer_id, datum)
);

create index if not exists idx_zeit_nutzer on public.zeiterfassung(nutzer_id);
create index if not exists idx_zeit_datum  on public.zeiterfassung(datum);

alter table public.zeiterfassung enable row level security;

-- Jede Person sieht nur die eigene Historie, Admin sieht alle (Team-Leistung).
drop policy if exists zeit_lesen on public.zeiterfassung;
create policy zeit_lesen on public.zeiterfassung
  for select using (public.ist_admin() or nutzer_id = auth.uid());

-- Anlegen/Aendern nur fuer die eigene Zeile — niemand traegt fuer eine andere Person Zeit ein.
drop policy if exists zeit_anlegen on public.zeiterfassung;
create policy zeit_anlegen on public.zeiterfassung
  for insert with check (nutzer_id = auth.uid());

drop policy if exists zeit_aendern on public.zeiterfassung;
create policy zeit_aendern on public.zeiterfassung
  for update using (nutzer_id = auth.uid()) with check (nutzer_id = auth.uid());

-- Kein Loeschen: die Historie bleibt lueckenlos, wie bei aktivitaeten (A7).
