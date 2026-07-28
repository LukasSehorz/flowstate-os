-- =====================================================================
-- Flowstate — Kundenakte, Buchhaltung und Dokumente verbinden (Migration 0042)
--
-- Warum (28.07.2026): In der Kundenakte stand „Setup 2.000 €" und „Rechnung
-- voll bezahlt" — und weder der Umsatz auf der Zentrale noch die Einnahmen in
-- der Buchhaltung wussten davon. Drei Zahlen, drei Orte, keine Verbindung:
--
--   Umsatz (Zentrale)      = Summe der gewonnenen Deals
--   Einnahmen (Buchhaltung)= Summe der Buchungen
--   „Rechnung voll bezahlt" = ein Textfeld, das nichts auslöst
--
-- Ab jetzt erzeugt die Kundenakte eine echte Buchung, sobald ein Preis steht
-- und die Rechnung als bezahlt markiert ist.
--
-- 1) buchungen.quelle
--    Woher eine Buchung stammt: NULL = von Hand erfasst, 'kundenakte' = aus
--    einer Kundenakte erzeugt. Ohne diese Spalte liesse sich eine erzeugte
--    Buchung beim naechsten Speichern nicht wiedererkennen — und aus einem
--    zweiten Klick auf „Speichern" wuerden 2.000 € zweimal Umsatz.
--
-- 2) buchungen.quelle_schluessel
--    Welche Position genau: 'setup' oder 'monatlich'. Zusammen mit firma_id
--    eindeutig — daran haengt das Wiedererkennen.
--
-- 3) belege.firma_id
--    Eine Rechnung, die in der Kundenakte abgelegt wird, gehoert zu diesem
--    Kunden — und zwar ab dem Hochladen, nicht erst wenn sie gebucht ist.
--    Sonst waere sie bis zur Buchung heimatlos.
--
-- 4) dokumente.daten / dateityp / pruefsumme, pfad wird optional
--    Die Ablage in der Kundenakte hat bisher NICHTS gespeichert ("noch nicht
--    mit dem Speicher verbunden"). Die Tabelle war fuer Supabase-Storage
--    gedacht (pfad), der nie angeschlossen wurde. Dateien liegen jetzt wie die
--    Belege direkt in der Datenbank — ein Speicherort weniger, der ausfallen
--    kann, und dieselbe Sicherung deckt beides ab.
-- =====================================================================

alter table public.buchungen add column if not exists quelle             text;
alter table public.buchungen add column if not exists quelle_schluessel text;

comment on column public.buchungen.quelle is
  'NULL = von Hand erfasst · ''kundenakte'' = aus einer Kundenakte erzeugt (siehe crm.js einnahmeAusAkte).';

-- Je Firma und Position hoechstens EINE erzeugte Buchung. Der Index ist der
-- eigentliche Schutz gegen Doppelbuchungen — nicht die Sorgfalt im Code.
create unique index if not exists buchungen_akte_einmalig
  on public.buchungen (firma_id, quelle_schluessel)
  where quelle = 'kundenakte';

alter table public.belege add column if not exists firma_id bigint
  references public.firmen(id) on delete set null;
create index if not exists belege_firma_idx on public.belege (firma_id);

alter table public.dokumente add column if not exists daten      bytea;
alter table public.dokumente add column if not exists dateityp   text;
alter table public.dokumente add column if not exists pruefsumme text;
alter table public.dokumente add column if not exists groesse_neu bigint;
-- pfad war Pflicht (Supabase-Storage). Da die Datei jetzt in "daten" liegt,
-- gibt es keinen Pfad mehr — die Pflicht muss weg, sonst schlaegt jedes
-- Einfuegen fehl.
alter table public.dokumente alter column pfad drop not null;

comment on column public.dokumente.daten is
  'Die Datei selbst. Vorher war nur ein Storage-Pfad vorgesehen, der nie angebunden wurde.';
