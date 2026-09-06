-- =====================================================================
-- Flowstate — Rechnungen & Angebote als Datensatz (Migration 0060)
--
-- Warum (Lukas, 05.09.2026): "Aus dem Tool wollen wir Rechnungen und
-- Angebote erstellen und direkt an Kunden versenden — verknüpft mit dem
-- CRM/Dashboard: wie viel Umsatz schon generiert, wie viel noch offen. Bei
-- Kunden gibt es Abschlagsrechnungen: in der Kundenakte soll stehen, eine
-- ist raus und bezahlt, eine offen — 50 % bezahlt."
--
-- Bis heute erzeugte lib/beleg-erstellen.js Rechnungen nur als Datei aus
-- einer DOCX-Vorlage — ohne Datenbankzeile, ohne Positionen, ohne Zahlstand.
-- Eine Rechnung, die es nur als Datei gibt, kann weder die Akte noch das
-- Dashboard etwas fragen. Diese Tabelle ist der Ort, an dem eine Rechnung
-- (oder ein Angebot) als Vorgang lebt: Entwurf -> gestellt -> bezahlt.
--
-- EINE Tabelle fuer beide Arten (art = 'angebot' | 'rechnung'): Positionen,
-- Empfaenger, Texte und PDF sind identisch aufgebaut; nur der Nummernkreis
-- (lib/beleg-nummer.js) und die Statusfolge unterscheiden sich. Zwei Tabellen
-- waeren zwei Formulare, zwei Listen, zwei PDF-Wege.
--
-- Statusfolge
--   Angebot:  entwurf -> gestellt -> angenommen | abgelehnt
--   Rechnung: entwurf -> gestellt -> teilbezahlt -> bezahlt
--   storniert: jederzeit, mit Grund (storno_grund). Die Nummer bleibt
--   vergeben — eine Luecke ist erklaerbar, eine doppelte Nummer nicht.
--
-- Nummer erst beim STELLEN, nicht beim Anlegen: Ein Entwurf, der verworfen
-- wird, verbraucht so keine Nummer. Entwuerfe haben nummer = NULL und tragen
-- in der Oberflaeche "Entwurf". (unique laesst mehrere NULL zu.)
--
-- Das PDF wird beim Stellen erzeugt, in "pdf" abgelegt und mit Pruefsumme
-- eingefroren — dieselbe Idee wie belege.daten/pruefsumme aus 0024: Was beim
-- Kunden liegt, muss spaeter noch genau so aus dem System kommen.
--
-- Abschlag: abschlag_von zeigt auf den AUFTRAG (ein Angebot oder eine
-- Rechnung), abschlag_nr zaehlt durch, abschlag_prozent ist der Anteil.
-- angebot_id: aus welchem Angebot eine Rechnung hervorging.
--
-- Rechte: Schreiben nur Geschaeftsfuehrung (ist_admin). LESEN darf auch, wer
-- die Firma sehen darf — damit Louis in seiner Kundenakte den Zahlstand
-- sieht ("Abschlag 1 bezahlt, Abschlag 2 offen"). Die Unterabfrage auf firmen
-- laeuft selbst durch die firmen-Policies; wer die Firma nicht sieht, sieht
-- auch die Rechnung nicht.
-- =====================================================================

create table if not exists public.rechnungen (
  id               bigserial primary key,
  nummer           text unique,
  art              text not null check (art in ('angebot', 'rechnung')),
  firma_id         bigint references public.firmen(id) on delete set null,
  -- Schnappschuss des Empfaengers: {name, ansprechperson, strasse, plz_ort, email}.
  -- Bewusst kopiert, nicht verknuepft: Zieht der Kunde um, bleibt die alte
  -- Rechnung so, wie sie verschickt wurde.
  empfaenger       jsonb not null default '{}'::jsonb,
  datum            date not null default current_date,
  faellig          date,                      -- Rechnung: Zahlungsziel · Angebot: gueltig bis
  -- [{titel, beschreibung, menge, einheit, einzelpreis}]
  positionen       jsonb not null default '[]'::jsonb,
  summe            numeric(12,2) not null default 0,
  titel            text,                      -- Kurzbezeichnung ("Webseite"), fuer Listen und Abschlaege
  einleitung       text,                      -- Anschreiben ueber der Tabelle, je Belegart eigener Text
  schluss          text,
  -- Nutzenliste des Angebots: eine Zeile je Punkt, im PDF mit goldenem Quadrat.
  -- Nur Angebote fuellen sie; auf einer Rechnung wirbt niemand.
  nutzen           text,
  status           text not null default 'entwurf'
                   check (status in ('entwurf','gestellt','teilbezahlt','bezahlt','storniert','angenommen','abgelehnt')),
  bezahlt_am       date,                      -- Tag der letzten Zahlung (voll bezahlt: der Tag, an dem es voll wurde)
  bezahlt_betrag   numeric(12,2) not null default 0,
  -- [{am, betrag, buchung_id}] — jede Zahlung einzeln, jede mit ihrer Buchung
  zahlungen        jsonb not null default '[]'::jsonb,
  abschlag_von     bigint references public.rechnungen(id) on delete set null,
  abschlag_nr      int,
  abschlag_prozent numeric(5,2),
  angebot_id       bigint references public.rechnungen(id) on delete set null,
  versendet_am     timestamptz,
  versendet_an     text,
  buchung_id       bigint references public.buchungen(id) on delete set null,  -- die letzte Buchung
  pdf              bytea,
  pdf_pruefsumme   text,
  vorlage          text,                      -- website | ki | performance | frei
  storno_grund     text,
  erstellt_von     uuid references public.profiles(id),
  erstellt         timestamptz not null default now(),
  geaendert        timestamptz not null default now()
);

-- Falls die Tabelle aus einem frueheren Entwurf ohne diese Spalten stammt.
alter table public.rechnungen add column if not exists titel        text;
alter table public.rechnungen add column if not exists zahlungen    jsonb not null default '[]'::jsonb;
alter table public.rechnungen add column if not exists storno_grund text;
alter table public.rechnungen add column if not exists nutzen       text;

create index if not exists rechnungen_firma_idx  on public.rechnungen (firma_id);
create index if not exists rechnungen_status_idx on public.rechnungen (status);
create index if not exists rechnungen_datum_idx  on public.rechnungen (datum desc);
create index if not exists rechnungen_abschlag_idx on public.rechnungen (abschlag_von) where abschlag_von is not null;

comment on table public.rechnungen is
  'Rechnungen und Angebote als Vorgang (05.09.2026). Nummer aus lib/beleg-nummer.js beim Stellen; PDF beim Stellen eingefroren.';
comment on column public.rechnungen.nutzen is
  'Nutzenliste des Angebots, eine Zeile je Punkt (Hausvorlage: goldene Quadrate ueber der Tabelle).';
comment on column public.rechnungen.zahlungen is
  '[{am, betrag, buchung_id}] — eine Buchung (art einnahme, quelle ''rechnung'') je Zahlung.';

-- geaendert laeuft von selbst mit (Muster 0056_whiteboard.sql).
create or replace function public.rechnungen_beruehrt()
returns trigger
language plpgsql
as $$
begin
  new.geaendert := now();
  return new;
end;
$$;

drop trigger if exists rechnungen_beruehrt on public.rechnungen;
create trigger rechnungen_beruehrt
  before update on public.rechnungen
  for each row execute function public.rechnungen_beruehrt();

-- ---------------------------------------------------------------------
-- Jede Zahlung auf eine Rechnung wird EINE Buchung (art einnahme, bezahlt,
-- quelle 'rechnung', quelle_schluessel 'rechnung-<id>-<zahlung>'). Der Index
-- ist der eigentliche Schutz gegen Doppelbuchungen — nicht die Sorgfalt im
-- Code (dieselbe Regel wie buchungen_akte_einmalig aus 0042).
-- ---------------------------------------------------------------------
create unique index if not exists buchungen_rechnung_einmalig
  on public.buchungen (quelle_schluessel)
  where quelle = 'rechnung';

-- ---------------------------------------------------------------------
-- Rechte
-- ---------------------------------------------------------------------
alter table public.rechnungen enable row level security;

drop policy if exists rechnungen_lesen on public.rechnungen;
create policy rechnungen_lesen on public.rechnungen
  for select using (
    public.ist_admin()
    or exists (select 1 from public.firmen f where f.id = rechnungen.firma_id)
  );

drop policy if exists rechnungen_anlegen on public.rechnungen;
create policy rechnungen_anlegen on public.rechnungen
  for insert with check (public.ist_admin());

drop policy if exists rechnungen_aendern on public.rechnungen;
create policy rechnungen_aendern on public.rechnungen
  for update using (public.ist_admin()) with check (public.ist_admin());

drop policy if exists rechnungen_loeschen on public.rechnungen;
create policy rechnungen_loeschen on public.rechnungen
  for delete using (public.ist_admin());
