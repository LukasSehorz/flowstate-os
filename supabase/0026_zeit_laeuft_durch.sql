-- =====================================================================
-- Flowstate — Stoppuhr laeuft durch (Migration 0026)
--
-- WAS VORHER NICHT STIMMTE
--
-- Die Uhr hat nicht Zeit gemessen, sondern Herzschlaege gezaehlt: Der Header
-- meldete sich alle 15 Sekunden, und nur was dabei ankam, wurde gutgeschrieben.
-- Kein Herzschlag, keine Zeit. Dazu kam eine Abschaltung nach 10 Minuten ohne
-- Maus- oder Tastaturbewegung, und zwar doppelt — einmal im Browser, einmal auf
-- dem Server. Wer eine halbe Stunde telefoniert oder in einer anderen Anwendung
-- arbeitet, verlor diese Zeit. Beim Pausieren wurde ausserdem hoechstens die
-- Inaktivitaets-Schwelle nachgetragen, alles darueber fiel weg.
--
-- WIE ES JETZT ARBEITET
--
-- Statt Herzschlaege zu summieren, merkt sich die Zeile, WANN der laufende
-- Abschnitt begonnen hat:
--
--   sekunden     Summe aller abgeschlossenen Abschnitte des Tages
--   laeuft_seit  Beginn des laufenden Abschnitts, oder NULL wenn gerade nicht laeuft
--
--   Angezeigte Zeit = sekunden + (jetzt - laeuft_seit)
--
-- Damit ergibt sich die Zeit aus der Uhr und nicht aus der Bedienung. Ob der
-- Laptop zugeklappt war, der Tab im Hintergrund lag oder eine Stunde niemand
-- die Maus bewegt hat, spielt keine Rolle mehr.
--
-- Angehalten wird nur noch auf Ansage: Pause, Abmelden oder Feierabend. Genau
-- diese drei Faelle schliessen den Abschnitt ab und rechnen ihn in "sekunden".
--
-- Der Herzschlag bleibt, hat aber keine rechnerische Aufgabe mehr — er haelt nur
-- noch die Anzeige im Gleichlauf. Faellt er aus, geht keine Zeit verloren.
--
-- TAGESGRENZE: Eine Zeile gilt fuer einen Tag. Bleibt ein Abschnitt ueber
-- Mitternacht offen (Laptop zugeklappt, nicht abgemeldet), wird er beim
-- naechsten Zugriff am Ende SEINES Tages geschlossen — er laeuft nicht in den
-- naechsten Tag hinein.
-- =====================================================================

alter table public.zeiterfassung add column if not exists laeuft_seit timestamptz;

-- Bestand: Zeilen, die noch auf 'gestartet' stehen, haben keinen Abschnittsbeginn.
-- Ihren bisherigen Stand behalten sie; als Beginn gilt das letzte Lebenszeichen.
-- Alles davor steckt bereits in "sekunden", es geht also nichts verloren und es
-- wird nichts doppelt gezaehlt.
update public.zeiterfassung
   set laeuft_seit = letzte_aktivitaet
 where status = 'gestartet' and laeuft_seit is null;

-- Alte offene Abschnitte aus vergangenen Tagen sauber abschliessen, damit sie
-- nicht ploetzlich Stunden gutgeschrieben bekommen.
update public.zeiterfassung
   set sekunden = sekunden + greatest(0, least(
         extract(epoch from ((datum + interval '1 day') - laeuft_seit))::int,
         extract(epoch from (now() - laeuft_seit))::int)),
       status = 'beendet',
       laeuft_seit = null
 where laeuft_seit is not null and datum < current_date;

comment on column public.zeiterfassung.laeuft_seit is
  'Beginn des laufenden Abschnitts. NULL = Uhr steht. Angezeigte Zeit = sekunden + (now() - laeuft_seit).';
