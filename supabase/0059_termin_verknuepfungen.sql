-- =====================================================================
-- Flowstate — Termine mit Kunden-/Lead-Akten verknuepfen (Migration 0059)
--
-- Wunsch Lukas, 05.09.2026: Wer im OS-Kalender einen Kundentermin eintraegt,
-- soll die Akte aus dem CRM anhaengen koennen — und beim Klick auf den Termin
-- die Akte sehen, ohne zwischen fuenf Tabs zu springen. Ein ueber Telesales
-- gebuchtes Erstgespraech soll von selbst im Kalender stehen.
--
-- Warum eine eigene Tabelle und keine Terminspalte: Termine liegen NICHT in
-- dieser Datenbank — Google ist die einzige Wahrheit (lib/kalender.js). Hier
-- wird nur der Faden gehalten: Google-Termin-ID -> Firma. Faellt die Zeile
-- weg (Firma geloescht, Termin abgesagt), ist nichts verloren, was nicht auch
-- in Google oder im CRM steht. Zur Sicherheit steht der Akte-Link zusaetzlich
-- als Zeile "Kundenakte: …" in der Terminbeschreibung — so findet auch ein
-- Termin, der vor dieser Migration angelegt wurde, seine Akte wieder.
--
-- art:
--   'termin'         von Hand im Kalender verknuepft
--   'erstgespraech'  vom CRM angelegt (kalender-akte.js: erstgespraechSynchronisieren).
--                    Je Firma hoechstens einer sinnvoll — wird das Datum in der
--                    Akte geaendert, wird DIESER Termin verschoben statt ein
--                    zweiter angelegt.
--
-- Rechte: sichtbar und aenderbar, wenn die Firma dahinter sichtbar ist. Die
-- Firmen-Policy (0002_rls.sql: Admin, Besitzer, gewonnen_durch, herrenlos)
-- filtert damit auch hier — ein Mitarbeiter sieht nur die Verknuepfungen
-- seiner Kunden. Wiederholbar einspielbar.
-- =====================================================================

create table if not exists public.termin_verknuepfungen (
  -- Die Google-Termin-ID (events.id). Ein Termin haengt an hoechstens einer Firma.
  event_id     text primary key,
  -- Welcher Google-Kalender (KALENDER_ID, leer = Hauptkalender). Nur Merkposten,
  -- damit ein Dreh-Kalender (lib/kalender-id.js) nicht mit dem echten verwechselt wird.
  kalender_id  text,
  firma_id     bigint not null references public.firmen(id) on delete cascade,
  art          text not null default 'termin' check (art in ('termin', 'erstgespraech')),
  angelegt_von uuid references public.profiles(id),
  erstellt     timestamptz default now()
);

comment on table public.termin_verknuepfungen is
  'Faden zwischen Google-Kalender-Termin (event_id) und Firma (Lead/Kunde). '
  'Termine selbst liegen bei Google; hier steht nur, welche Akte dazugehoert.';

create index if not exists termin_verknuepfungen_firma on public.termin_verknuepfungen (firma_id);

-- Auf Supabase haben anon/authenticated Standardrechte auf neue Tabellen; in
-- einer Nachbau-Datenbank nicht zwingend. Ausdruecklich vergeben schadet nie.
grant select, insert, update, delete on public.termin_verknuepfungen to authenticated;
grant select, insert, update, delete on public.termin_verknuepfungen to service_role;

alter table public.termin_verknuepfungen enable row level security;

drop policy if exists termin_verknuepfungen_lesen on public.termin_verknuepfungen;
create policy termin_verknuepfungen_lesen on public.termin_verknuepfungen
  for select using (
    auth.uid() is not null
    and exists (select 1 from public.firmen f where f.id = firma_id)
  );

drop policy if exists termin_verknuepfungen_anlegen on public.termin_verknuepfungen;
create policy termin_verknuepfungen_anlegen on public.termin_verknuepfungen
  for insert with check (
    auth.uid() is not null
    and exists (select 1 from public.firmen f where f.id = firma_id)
  );

drop policy if exists termin_verknuepfungen_aendern on public.termin_verknuepfungen;
create policy termin_verknuepfungen_aendern on public.termin_verknuepfungen
  for update using (
    auth.uid() is not null
    and exists (select 1 from public.firmen f where f.id = firma_id)
  ) with check (
    auth.uid() is not null
    and exists (select 1 from public.firmen f where f.id = firma_id)
  );

drop policy if exists termin_verknuepfungen_loeschen on public.termin_verknuepfungen;
create policy termin_verknuepfungen_loeschen on public.termin_verknuepfungen
  for delete using (
    auth.uid() is not null
    and exists (select 1 from public.firmen f where f.id = firma_id)
  );
