-- =====================================================================
-- Flowstate — Belegeingang mit Lexware-Übertragung (Migration 0022)
--
-- Der Belegeingang ist jetzt zweigeteilt: art = 'ausgabe' (Quittungen, Tank-
-- rechnungen, Eingangsrechnungen) oder 'einnahme' (unsere Rechnungen an Kunden).
--
-- Der Ablauf in drei Zustaenden:
--   'neu'        Datei ist da, Werte noch nicht bestaetigt
--   'gebucht'    bestaetigt, in Lexware angelegt, Buchung bei uns erzeugt
--   'fehler'     Übertragung an Lexware ist gescheitert (fehler_text sagt warum)
--
-- Die Datei selbst liegt nach der Übertragung in LEXWARE (lexware_datei_id) —
-- revisionssicher am richtigen Ort. Wir halten sie nur bis zur Bestaetigung
-- zwischen, danach wird daten geleert.
-- =====================================================================

alter table public.belege add column if not exists art             text;
alter table public.belege add column if not exists kategorie       text;
alter table public.belege add column if not exists gegenstelle     text;
alter table public.belege add column if not exists steuersatz      numeric(4,1);
alter table public.belege add column if not exists belegnummer     text;
alter table public.belege add column if not exists lexware_id      text;
alter table public.belege add column if not exists lexware_datei_id text;
alter table public.belege add column if not exists fehler_text     text;
alter table public.belege add column if not exists dateityp        text;
-- Zwischenspeicher fuer die Datei bis zur Bestaetigung. Danach wieder null.
alter table public.belege add column if not exists daten           bytea;

-- Alte Prüfregel ersetzen: es gibt jetzt drei Zustaende statt zwei.
alter table public.belege drop constraint if exists belege_status_check;
update public.belege set status = 'neu' where status = 'offen';
update public.belege set status = 'gebucht' where status = 'zugeordnet';
alter table public.belege add constraint belege_status_check
  check (status in ('neu', 'gebucht', 'fehler'));

alter table public.belege alter column status set default 'neu';

create index if not exists belege_art_status_idx on public.belege (art, status, erstellt desc);
