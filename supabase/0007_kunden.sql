-- =====================================================================
-- Flowstate CRM — Kundenakte (Migration 0007)
-- Sobald aus einem Lead ein Kunde wird, zaehlen andere Dinge als im Vertrieb:
--   preis_setup      einmaliger Preis (Projekt / Setup)
--   preis_monatlich  laufender Retainer pro Monat
--   leistungen       was wir konkret liefern (monatliche Betreuung, Hosting, ...)
--   kontakt_kanaele  worueber wir mit dem Kunden sprechen (E-Mail, WhatsApp, Telefon)
-- =====================================================================

alter table public.firmen add column if not exists preis_setup numeric;
alter table public.firmen add column if not exists preis_monatlich numeric;
alter table public.firmen add column if not exists leistungen text[] default '{}';
alter table public.firmen add column if not exists kontakt_kanaele text[] default '{}';
