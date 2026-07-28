-- =====================================================================
-- Flowstate — Retainer getrennt vom Setup abrechnen (Migration 0045)
--
-- Warum (28.07.2026): Fuchspool zahlt 1.500 € Setup (schon eingegangen) plus
-- 100 € im Monat über drei Monate (noch nichts eingegangen). Das liess sich
-- nirgends ausdruecken:
--
--   1) Der Umsatz rechnete "Setup + EIN Monat" = 1.600 € statt 1.800 €.
--      Die Laufzeit stand zwar in der Akte, ging aber nur in die Anzeige der
--      Pipeline-Karte ein — nicht in den Abschluss. Zwei Zahlen fuer denselben
--      Kunden, und die kleinere war die, auf die sich alles stuetzte.
--
--   2) "Rechnung bezahlt" war EIN Feld fuer den ganzen Kunden. Setup bezahlt
--      und Retainer offen war schlicht nicht darstellbar. Auf "voll bezahlt"
--      gestellt haette die Buchhaltung 1.600 € Einnahmen gezeigt, obwohl
--      1.500 € geflossen sind.
--
-- Ab jetzt:
--
--   rechnung_stand              gilt NUR noch fuers Setup.
--   retainer_monate_bezahlt     wie viele Monatsbeitraege eingegangen sind.
--                               Jeder bezahlte Monat wird EINZELN gebucht, mit
--                               dem Datum seines Monats — sonst laegen drei
--                               Monatsbeitraege im selben Monat und die
--                               Umsatzkurve waere falsch.
--
--   fuer_position               Wofuer eine echte Rechnung steht: 'setup' oder
--                               'monatlich'. Damit wird sie GEGEN den Zaehler
--                               verrechnet statt obendrauf gezaehlt. Wer die
--                               Monatsrechnung hochlaedt UND den Zaehler stellt,
--                               soll 100 € sehen und nicht 200 €.
-- =====================================================================

alter table public.firmen
  add column if not exists retainer_monate_bezahlt integer not null default 0;

comment on column public.firmen.retainer_monate_bezahlt is
  'Wie viele Monatsbeitraege der Kunde bezahlt hat. rechnung_stand gilt seit 0045 nur noch fuers Setup.';

-- Ein Zaehler darf nicht negativ sein und nicht ins Blaue laufen. 120 Monate
-- sind zehn Jahre — grosszuegig genug fuer jeden Vertrag, eng genug, um einen
-- Zahlendreher zu fangen.
alter table public.firmen drop constraint if exists firmen_retainer_monate_bereich;
alter table public.firmen add constraint firmen_retainer_monate_bereich
  check (retainer_monate_bezahlt >= 0 and retainer_monate_bezahlt <= 120);

alter table public.buchungen add column if not exists fuer_position text;
alter table public.belege    add column if not exists fuer_position text;

comment on column public.buchungen.fuer_position is
  'Wofuer diese Einnahme steht: ''setup'' oder ''monatlich''. Bei Buchungen aus einer '
  'hochgeladenen Rechnung gesetzt, damit sie gegen den Stand in der Kundenakte '
  'verrechnet und nicht doppelt gezaehlt wird.';

create index if not exists buchungen_position_idx
  on public.buchungen (firma_id, fuer_position)
  where art = 'einnahme';
