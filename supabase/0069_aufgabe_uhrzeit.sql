-- =====================================================================
-- Flowstate — Die verabredete Uhrzeit einer CRM-Aufgabe: aufgaben.geplant_um
-- (Migration 0069, 14.09.2026)
--
-- Wunsch Lukas, 14.09.2026: Ein Follow-up, fuer das am Telefon eine Uhrzeit
-- ausgehandelt wurde, soll auch UM DIESE UHRZEIT im Google Kalender stehen.
--
-- Was schon stand: Seit 0066/0067 bekommt jede CRM-Aufgabe mit Firma und
-- Datum einen eigenen Kalendereintrag (lib/crm.js aufgabeInKalender), und seit
-- heute steht beim Follow-up auch der richtige TAG in der Aufgabe. Was fehlte,
-- ist die UHRZEIT: aufgaben kannte nur geplant_am und faellig, beide date.
-- Damit legte ersterFreierPlatz() den Block ins erste freie Fenster ab 9:00 —
-- bei KFZ Holzer also 9:00, obwohl mit Herrn Holzer 10:00 vereinbart war. Die
-- Uhrzeit stand nur in der Gespraechsnotiz und im Titel der Aufgabe.
--
-- WARUM EINE SPALTE UND KEIN LESEN AUS DEM TITEL: Der Titel ist Anzeigetext
-- ("Nachfassen am 21.09. um 10:00"). Ihn zurueckzulesen waere genau der
-- Fehler, den Migration 0066 fuer die Dublettenerkennung schon ausdruecklich
-- verworfen hat — ein Titel aendert sich, sobald jemand die Formulierung
-- anfasst, und dann verschiebt sich stillschweigend ein Kundentermin.
--
-- WARUM time UND NICHT timestamptz: Der Tag steht schon in geplant_am. Eine
-- zweite Spalte mit eigenem Datum koennte ihm widersprechen ("welcher Tag
-- gilt?"), und genau diese Doppeldeutigkeit hat heute beim Follow-up-Termin
-- zwei Stunden Abweichung erzeugt. time ist WANDZEIT: 10:00 heisst 10:00 in
-- dem Kalender, in dem der Termin steht — der Container laeuft seit heute auf
-- Europe/Berlin (docker-compose.yml, TZ), und Google bekommt "JJJJ-MM-TTT10:00"
-- ohne Zonenangabe, also die Zeit des Kalenders. Ein timestamptz muesste bei
-- jedem Lesen wieder in Wandzeit zurueckgerechnet werden.
--
-- NULL ist der Normalfall und heisst "keine Uhrzeit verabredet": Dann bleibt
-- es beim bisherigen Verhalten, also erstes freies Fenster ab 9:00. Ist eine
-- Uhrzeit gesetzt, wird ab ihr gesucht — belegt der Kalender sie schon,
-- rutscht der Block auf die naechste freie Luecke DANACH, statt sich in einen
-- bestehenden Termin zu legen (lib/crm.js ersterFreierPlatz, optionen.von).
--
-- Mitternacht wird nicht gesondert behandelt: Anders als bei
-- erstgespraech_am (0051) gibt es hier keine Altwerte, die von einer
-- date-Spalte stammen und darum auf 00:00 stehen. Wer 00:00 eintraegt, meint
-- 00:00 — die Maske laesst das ohnehin nicht zu (zeitpunktLesen wertet 00:00
-- als "keine Uhrzeit" und schreibt dann NULL).
--
-- Kein Index: Die Spalte wird nie gesucht, nur zusammen mit der Aufgabe
-- gelesen, die man ohnehin schon in der Hand hat.
--
-- Wiederholbar: add column if not exists.
-- =====================================================================

alter table public.aufgaben add column if not exists geplant_um time;

comment on column public.aufgaben.geplant_um is
  'Verabredete Uhrzeit als Wandzeit (z. B. 10:00 = 10:00 im Kalender, in dem '
  'der Termin steht). NULL = keine Uhrzeit vereinbart, dann sucht '
  'ersterFreierPlatz() das erste freie Fenster ab 9:00 (lib/crm.js, 0069). '
  'Der Tag steht in geplant_am — diese Spalte traegt bewusst kein Datum.';
