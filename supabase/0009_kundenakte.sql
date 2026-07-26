-- =====================================================================
-- Flowstate CRM — Kundenakte erweitern (Migration 0009)
--   geschlecht        fuer das Avatarbild der Ansprechperson (m | w | d)
--   taetigkeit        was die Firma des Kunden selbst anbietet
--   mitarbeiter_zahl  wie gross die Firma ist
--   vertrag_laufzeit  wie lange die Zusammenarbeit laeuft
--   hosting           nur Webdesign: hosten wir die Seite selbst?
--   leads_ziel/_ist   nur Performance Marketing: vereinbarte und erreichte Leads
--   umgesetzt         was wir fuer den Kunden umgesetzt haben (freie Liste)
-- =====================================================================

alter table public.firmen add column if not exists geschlecht text;
alter table public.firmen add column if not exists taetigkeit text;
alter table public.firmen add column if not exists mitarbeiter_zahl int;
alter table public.firmen add column if not exists vertrag_laufzeit text;
alter table public.firmen add column if not exists hosting boolean;
alter table public.firmen add column if not exists leads_ziel int;
alter table public.firmen add column if not exists leads_ist int;
alter table public.firmen add column if not exists umgesetzt text[] default '{}';
