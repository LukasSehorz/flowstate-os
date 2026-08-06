-- =====================================================================
-- Flowstate — Das Erstgespräch bekommt eine Uhrzeit (Migration 0051)
--
-- Wunsch Lukas, 06.08.2026: In der Lead-Akte soll man zum Erstgespräch die
-- Uhrzeit eintragen können, und sie soll auf der Pipeline-Karte stehen.
--
-- Warum das fehlte, obwohl die Uhrzeit längst erfasst wurde: Beim Buchen im
-- Cold Call fragt der Dialog nach "Termin" samt Uhrzeit — sie landete aber nur
-- im Notiztext. Bei der Fahrschule Baptistella stand in der Notiz
-- "Termin 2026-08-12T14:00", im Terminfeld dagegen der 12.08. ohne Zeit. Wer
-- auf die Karte sah, wusste den Tag und musste die Uhrzeit in der Notiz suchen.
--
-- date -> timestamptz. Vorhandene Termine werden Mitternacht des bisherigen
-- Tages; das heisst ab jetzt "Tag bekannt, Uhrzeit nicht". Ein Erstgespräch um
-- 00:00 gibt es nicht, die Verwechslungsgefahr ist also keine — und die Anzeige
-- laesst die Uhrzeit bei Mitternacht weg, statt "00:00 Uhr" zu behaupten.
--
-- Die Umrechnung laeuft ausdruecklich in Europe/Berlin: Ohne Zeitzone nimmt
-- Postgres die der Sitzung. Beim Einspielen aus einem Container, der auf UTC
-- steht, waeren alle Termine zwei Stunden verrutscht — aus dem 12.08. 00:00
-- wuerde der 11.08. 22:00, und jede Karte zeigte den Vortag.
-- =====================================================================

alter table public.firmen
  alter column erstgespraech_am type timestamptz
  using (erstgespraech_am::timestamp at time zone 'Europe/Berlin');

comment on column public.firmen.erstgespraech_am is
  'Termin des Erstgesprächs (bei KI: Readiness-Check) mit Uhrzeit. '
  'Mitternacht bedeutet: Tag bekannt, Uhrzeit nicht angegeben — die Anzeige '
  'laesst die Uhrzeit dann weg.';
