-- =====================================================================
-- Flowstate CRM — Projekt- und Zahlungsstand (Migration 0010)
--   projekt_stand           wo stehen wir: Onboarding | Umsetzung | Live
--   rechnung_stand          offen | 50 (Anzahlung) | 100 (voll bezahlt)
--   vertrag_unterschrieben  liegt der unterschriebene Vertrag vor?
-- =====================================================================

alter table public.firmen add column if not exists projekt_stand text;
alter table public.firmen add column if not exists rechnung_stand text;
alter table public.firmen add column if not exists vertrag_unterschrieben boolean;
