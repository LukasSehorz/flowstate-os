-- =====================================================================
-- Flowstate — Genauer Zahlungseingang je Kunde (Migration 0072, 20.09.2026)
--
-- Bisher kannte die Akte nur "Rechnung offen / 50 % / voll bezahlt". Das
-- reicht nicht: Bausch & Company hat eine Abschlagsrechnung ueber 500 € von
-- 1.500 € bezahlt — das sind 33 %, und mit 50 % stuenden 250 € zu viel im
-- Umsatz. Darum ein Feld fuer den EXAKTEN eingegangenen Betrag.
--
-- Leer (NULL) heisst: nicht gesetzt, dann gilt weiter ganz/50/nein. Nur wo
-- jemand eine Zahl eintraegt, schlaegt sie den Anteil.
-- Gerechnet wird damit in lib/crm.js (einnahmeAusAkte), angezeigt in der
-- Kundenakte und auf der Zentrale.
-- =====================================================================

alter table public.firmen
  add column if not exists bezahlt_betrag numeric;

comment on column public.firmen.bezahlt_betrag is
  'Exakt eingegangener Betrag in Euro. NULL = nicht gesetzt, dann gilt rechnung_stand (offen/50/100).';
