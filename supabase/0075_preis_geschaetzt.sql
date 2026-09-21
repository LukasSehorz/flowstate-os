-- 0075 — Geschaetzter Preis oder vereinbarter Preis (20.09.2026)
--
-- Warum: Bei einem Lead steht oft schon eine Zahl im Raum, die noch niemand
-- zugesagt hat — bei Linda Bau etwa 10.000 € Setup und 500 € im Monat. Bisher
-- sah diese Zahl auf der Karte genauso aus wie ein fest vereinbarter Preis.
-- Zwei sehr verschiedene Dinge in derselben Schrift: Man haette am Ende eine
-- Pipeline gehabt, in der niemand mehr weiss, was besprochen und was geraten
-- ist.
--
-- Jetzt traegt die Firma einen Schalter. Steht er auf "geschaetzt", zeigen
-- Karte und Akte ein "≈" und den Vermerk. Wird der Deal gewonnen, stellt man
-- ihn auf "vereinbart" und traegt den echten Preis ein — bewusst von Hand,
-- denn nur der Mensch weiss, was tatsaechlich vereinbart wurde.
--
-- Default false: Alles, was bis heute drinsteht, ist ein echter Preis. Eine
-- Schaetzung ist die Ausnahme, und wer schaetzt, sagt es.
alter table public.firmen
  add column if not exists preis_geschaetzt boolean not null default false;

comment on column public.firmen.preis_geschaetzt is
  'true = preis_setup/preis_monatlich sind geschaetzt, nicht mit dem Kunden vereinbart.';
