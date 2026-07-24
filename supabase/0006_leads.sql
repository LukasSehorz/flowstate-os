-- =====================================================================
-- Flowstate CRM — Leads erweitern (Migration 0006)
-- 1) geschaeftsfuehrer: steht in der Cold-Calling-Liste als eigene Spalte und
--    wird beim Anlegen eines Leads mit erfasst.
-- 2) anruf_notiz: die Notiz aus dem Anruf ("Später nochmal", Gespraechsnotiz).
--    Der Absage-Grund liegt weiterhin in verlust_grund.
--    Beides wird beim Oeffnen der Liste wieder in die Detail-Spalte gefuellt.
-- =====================================================================

alter table public.firmen add column if not exists geschaeftsfuehrer text;
alter table public.firmen add column if not exists anruf_notiz text;
