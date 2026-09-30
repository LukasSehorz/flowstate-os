-- 0078 — Fotografierte Belege werden als PDF abgelegt (30.09.2026)
--
-- Lukas: "Wenn ich ein Bild hochlade, entweder über das Handy oder über den
-- Laptop, soll automatisch die Rechnung im PDF-Format abgespeichert werden,
-- weil unsere Steuerberaterin so ist."
--
-- Bis heute lag im Archiv das, was hochgeladen wurde: PDFs aus dem Postfach,
-- JPEGs aus der Handykamera. Der Monatsordner für die Kanzlei (lib/archiv.js)
-- enthielt damit beides gemischt, und dort musste jemand von Hand wandeln.
--
-- AB JETZT: Beim Hochladen wird ein JPEG in ein einseitiges PDF gelegt
-- (lib/beleg-als-pdf.js). In belege.daten steht das PDF, und damit ist jeder
-- Beleg im Archiv und im Monatsordner ein PDF.
--
-- DAS ORIGINAL GEHT NICHT VERLOREN. Es wandert in drei neue Spalten:
--
--   original            die Bytes des Kamerabildes, unverändert
--   original_dateiname  wie die Datei hieß
--   original_dateityp   image/jpeg
--
-- WARUM DAS WICHTIG IST (GoBD): Aufbewahrungspflichtig ist die bildliche
-- Wiedergabe des Originals. Das PDF enthält exakt dieselben JPEG-Daten —
-- beim Einbetten wird nichts neu kodiert, kein Pixel verändert. Trotzdem
-- bleibt das Original erhalten, damit sich das jederzeit nachweisen lässt:
-- Wer PDF und Original nebeneinanderlegt, sieht dieselben Bytes.
--
-- Die Prüfsumme in belege.pruefsumme bezieht sich weiterhin auf
-- belege.daten — also auf das, was ausgeliefert wird. Zusätzlich merken wir
-- uns die Prüfsumme des Originals, damit auch dessen Unverändertheit
-- nachweisbar ist.
--
-- Der Löschschutz aus 0024 gilt unverändert: Was einmal in daten steht, wird
-- nie ersetzt. Die Umwandlung passiert deshalb VOR dem Einfügen, nicht danach.

alter table public.belege
  add column if not exists original bytea,
  add column if not exists original_dateiname text,
  add column if not exists original_dateityp text,
  add column if not exists original_pruefsumme text;

comment on column public.belege.original is
  'Die unveränderte Originaldatei, wenn beim Hochladen in PDF gewandelt wurde (Kamerabild). Null = daten IST das Original.';
comment on column public.belege.original_pruefsumme is
  'SHA-256 des Originals — belegt, dass das im PDF eingebettete Bild unverändert ist.';

-- Auch das Original ist aufbewahrungspflichtig: einmal gesetzt, nie ersetzt.
-- Dieselbe Regel wie für daten (0024), nur für die neue Spalte.
create or replace function public.belege_schutz() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    raise exception
      'Belege dürfen nicht gelöscht werden (Aufbewahrungspflicht). Setze status = ''verworfen'' mit Grund.';
  end if;

  if old.daten is not null and new.daten is distinct from old.daten then
    raise exception 'Die Belegdatei darf nicht ersetzt oder geleert werden (Aufbewahrungspflicht).';
  end if;
  -- NEU 0078: dasselbe für das Kamerabild hinter einem gewandelten PDF.
  if old.original is not null and new.original is distinct from old.original then
    raise exception 'Das Original der Belegdatei darf nicht ersetzt oder geleert werden (Aufbewahrungspflicht).';
  end if;
  if old.pruefsumme is not null and new.pruefsumme is distinct from old.pruefsumme then
    raise exception 'Die Prüfsumme darf nicht verändert werden (Aufbewahrungspflicht).';
  end if;
  if old.laufnummer is not null and new.laufnummer is distinct from old.laufnummer then
    raise exception 'Die Laufnummer darf nicht verändert werden (Aufbewahrungspflicht).';
  end if;
  if new.erstellt is distinct from old.erstellt then
    raise exception 'Der Eingangszeitpunkt darf nicht verändert werden (Aufbewahrungspflicht).';
  end if;
  if old.dateiname is not null and new.dateiname is distinct from old.dateiname then
    raise exception 'Der Dateiname darf nicht verändert werden (Aufbewahrungspflicht).';
  end if;

  if old.verworfen_am is not null and new.verworfen_am is null then
    raise exception 'Ein verworfener Beleg kann nicht zurückgeholt werden. Lade ihn neu hoch.';
  end if;

  return new;
end $$;
