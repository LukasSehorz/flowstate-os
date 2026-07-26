-- =====================================================================
-- Flowstate CRM — Follow-up auch bei KI (Migration 0014)
--
-- Nach dem ersten Kontakt wird auch im KI-Vertrieb nachgefasst, bevor ein
-- Readiness-Check zustande kommt. Ohne eigene Phase dafuer blieben diese
-- Leads auf "Neu" liegen und man sah nicht, wer schon angefasst wurde.
--
-- Neue Reihenfolge KI / Verkauf:
--   Neu → Follow-up → Readiness-Check gebucht → Check gehalten
--       → Report versendet → Zweites Erstgespräch → Angebot → Gewonnen
--
-- Auf (sparte, art, position) liegt eine Eindeutigkeitsregel, darum parken
-- wir die Pipeline erst bei +100 und setzen danach die Zielpositionen.
-- =====================================================================

update public.pipeline_stages set position = position + 100 where sparte='ki' and art='vertrieb';

insert into public.pipeline_stages (sparte, art, position, name, ist_abschluss)
select 'ki', 'vertrieb', 2, 'Follow-up', false
 where not exists (select 1 from public.pipeline_stages
                    where sparte='ki' and art='vertrieb' and name='Follow-up');

update public.pipeline_stages set position = 1 where sparte='ki' and art='vertrieb' and name='Neu';
update public.pipeline_stages set position = 3 where sparte='ki' and art='vertrieb' and name='Readiness-Check gebucht';
update public.pipeline_stages set position = 4 where sparte='ki' and art='vertrieb' and name='Check gehalten';
update public.pipeline_stages set position = 5 where sparte='ki' and art='vertrieb' and name='Report versendet';
update public.pipeline_stages set position = 6 where sparte='ki' and art='vertrieb' and name='Zweites Erstgespräch';
update public.pipeline_stages set position = 7 where sparte='ki' and art='vertrieb' and name='Angebot';
update public.pipeline_stages set position = 8 where sparte='ki' and art='vertrieb' and name='Gewonnen';
