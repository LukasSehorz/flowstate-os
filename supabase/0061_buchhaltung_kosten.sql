-- =====================================================================
-- Flowstate — Buchhaltung: offene Ausgaben, Fixkosten, Belegquelle,
-- Monatsabschluss-Status (Migration 0061, 05.09.2026)
--
-- Anlass: Lukas will ein Kosten-Dashboard ("was müssen wir noch zahlen, was
-- ist schon gezahlt"), den Monatsabschluss als Excel mit Versand an die
-- Kanzlei, und wissen, woher ein Beleg kam (Handy, Mail, Telegram).
--
-- 1) buchungen.intervall / naechste_faelligkeit
--    Die Spalte "wiederkehrend" (0021) wurde im Dialog gesetzt und nirgends
--    ausgewertet. Jetzt traegt EINE Buchung je wiederkehrender Kostenstelle
--    das Intervall — sie ist die Vorlage UND die erste echte Zahlung. Die
--    Kosten-Seite rechnet daraus die monatliche Last (jaehrlich / 12) und
--    zeigt "faellig am <naechste_faelligkeit>". Folgebuchungen entstehen NICHT
--    von selbst, sondern nur per Klick "Diesen Monat gebucht" — dann wird
--    eine EINMALIGE Buchung (quelle = 'fixkosten') angelegt und die Vorlage
--    um ein Intervall weitergeschoben. So gibt es je Kostenstelle genau eine
--    Zeile mit Intervall, und nichts wird doppelt gezaehlt.
--
--    Offene Ausgaben brauchen keine neue Spalte: bezahlt/faellig/bezahlt_am
--    gibt es seit 0021/0024. Bisher hat nur der Code erzwungen, dass eine
--    Ausgabe immer bezahlt ist — das ist aufgehoben (lib/buchhaltung.js).
--
-- 2) belege.quelle
--    Ueber welchen Weg der Beleg hereinkam: 'web' (Ablagezone im Browser),
--    'handy' (Scan-Seite), 'telegram', 'mail' (Postfach-Import), 'akte'
--    (Kundenakte). NULL = Altbestand vor dieser Migration. Reine Statistik
--    fuer den Belegeingang ("12 aus Mail, 3 vom Handy"), keine Logik daran.
--
-- 3) monats_exporte.excel_geholt_am / an_kanzlei_am
--    Der Monatsabschluss hat jetzt drei Stufen: Excel geholt, ZIP geholt,
--    an die Kanzlei gegangen. Jede Handlung schreibt wie bisher EINE Zeile
--    ins Protokoll; die beiden neuen Spalten sagen, welche Handlung es war
--    (beide NULL = ZIP wie bisher). Der Status eines Monats ist die juengste
--    Zeile je Art — abgeleitet in lib/buchhaltung.js monatsStatus().
--
-- Wiederholbar: add column if not exists, drop/create fuer Pruefregel und
-- Index.
-- =====================================================================

-- ------------------------------------------------------------ 1) Fixkosten
alter table public.buchungen add column if not exists intervall            text;
alter table public.buchungen add column if not exists naechste_faelligkeit date;

alter table public.buchungen drop constraint if exists buchungen_intervall_check;
alter table public.buchungen add constraint buchungen_intervall_check
  check (intervall is null or intervall in ('monatlich', 'jaehrlich'));

comment on column public.buchungen.intervall is
  'NULL = einmalig · ''monatlich'' / ''jaehrlich'' = diese Buchung ist die Vorlage einer wiederkehrenden Kostenstelle (Kosten-Seite). Folgebuchungen nur per Klick, siehe lib/buchhaltung.js fixkostenBuchen().';
comment on column public.buchungen.naechste_faelligkeit is
  'Nur bei intervall: wann die naechste Zahlung ansteht. Wird beim Klick "Diesen Monat gebucht" um ein Intervall weitergeschoben.';

-- Altbestand: wer bisher "monatlich wiederkehrend" angekreuzt hat, bekommt das
-- Intervall nachgetragen, damit die Kosten-Seite ihn sofort zeigt. Naechste
-- Faelligkeit = ein Monat nach dem Buchungsdatum.
update public.buchungen
   set intervall = 'monatlich',
       naechste_faelligkeit = (datum + interval '1 month')::date
 where wiederkehrend = true and intervall is null;

-- Je Vorlage und Monat hoechstens EINE erzeugte Folgebuchung. Der Index ist
-- der eigentliche Schutz gegen einen Doppelklick auf "Diesen Monat gebucht" —
-- dasselbe Muster wie buchungen_akte_einmalig (0042).
create unique index if not exists buchungen_fixkosten_einmalig
  on public.buchungen (quelle_schluessel)
  where quelle = 'fixkosten';

create index if not exists buchungen_intervall_idx
  on public.buchungen (naechste_faelligkeit)
  where intervall is not null;

-- Offene Ausgaben werden nach Faelligkeit gelistet; der bestehende Index
-- buchungen_offen_idx (bezahlt, faellig) deckt das schon ab.

-- --------------------------------------------------------- 2) Belegquelle
alter table public.belege add column if not exists quelle text;

alter table public.belege drop constraint if exists belege_quelle_check;
alter table public.belege add constraint belege_quelle_check
  check (quelle is null or quelle in ('web', 'handy', 'telegram', 'mail', 'akte'));

comment on column public.belege.quelle is
  'Wie der Beleg hereinkam: web · handy · telegram · mail · akte. NULL = vor Migration 0061. Kopfzeile X-Quelle am Upload-Endpunkt, Standard web.';

-- -------------------------------------------------- 3) Monatsabschluss-Status
alter table public.monats_exporte add column if not exists excel_geholt_am timestamptz;
alter table public.monats_exporte add column if not exists an_kanzlei_am   timestamptz;

comment on column public.monats_exporte.excel_geholt_am is
  'Gesetzt, wenn diese Protokollzeile ein Excel-Abruf war (statt ZIP).';
comment on column public.monats_exporte.an_kanzlei_am is
  'Gesetzt, wenn diese Protokollzeile die Uebergabe an die Steuerkanzlei war (Entwurf angelegt oder gesendet, je STEUER_MODUS).';
