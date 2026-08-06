-- =====================================================================
-- Flowstate — "keine" ist keine Webseite (Migration 0049)
--
-- Gemeldet am 06.08.2026: In der Cold-Calling-Liste stand bei Leads ohne
-- Webseite trotzdem der Link "Website ↗". Wer draufklickte, landete auf einer
-- Fehlerseite des CRM.
--
-- Der Grund steckte in den Daten, nicht in der Anzeige: In der importierten
-- Tabelle stand in der Spalte Website woertlich das Wort "keine". Fuer die
-- Oberflaeche ist das ein Wert wie jeder andere — sie baut daraus
-- <a href="keine">, und weil dort kein http:// davorsteht, liest der Browser
-- es als Adresse INNERHALB des CRM. Aus "keine Webseite" wurde so ein Link
-- auf eine CRM-Seite, die es nicht gibt.
--
-- Zwei Sorten kaputter Werte:
--   1. Platzhalter statt Adresse: keine, kein, -, --, n/a, none, null …
--      -> das heisst "es gibt keine". Gehoert auf NULL.
--   2. Echte Adresse ohne Protokoll: "breakoutledon.de"
--      -> das heisst "es gibt eine", nur unvollstaendig. Bekommt https://.
--
-- Der Unterschied zaehlt: Bei 1 ist die fehlende Webseite ein Verkaufsargument
-- (Score 10 in der Lead-Bewertung), bei 2 waere das schlicht falsch.
--
-- Wiederholbar: Beide Schritte fassen nur an, was noch nicht stimmt.
-- =====================================================================

-- 1) Platzhalter -> NULL
update public.firmen
   set website = null
 where website is not null
   and lower(btrim(website)) in
       ('keine', 'kein', 'keine webseite', 'keine website', 'nein',
        '-', '--', '—', '–', '.', '/', 'n/a', 'na', 'none', 'null', 'kA', 'k.a.');

-- Leere und Nur-Leerzeichen-Werte gehoeren ebenfalls auf NULL — sonst ist
-- "keine Webseite" mal NULL und mal '', und jede Abfrage muss beides kennen.
update public.firmen
   set website = null
 where website is not null and btrim(website) = '';

-- 2) Adresse ohne Protokoll -> https:// davor.
-- Nur wenn wenigstens ein Punkt drin steckt: sonst ist es keine Domain,
-- sondern wieder ein Platzhalter, den Schritt 1 nicht kannte.
update public.firmen
   set website = 'https://' || btrim(website)
 where website is not null
   and btrim(website) <> ''
   and website !~* '^https?://'
   and btrim(website) like '%.%';

-- Was Schritt 1 und 2 beide nicht erfassen (kein Protokoll, kein Punkt), ist
-- weder Adresse noch bekannter Platzhalter — etwa ein Tippfehler. Auf NULL,
-- damit daraus kein klickbarer Link wird.
update public.firmen
   set website = null
 where website is not null
   and website !~* '^https?://';
