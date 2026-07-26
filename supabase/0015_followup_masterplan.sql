-- =====================================================================
-- Flowstate CRM — Follow-up nach dem Erstgespräch + KI-Masterplan (0015)
--
-- 1) FOLLOW-UP NACH DEM ERSTGESPRÄCH (alle drei Bereiche, 65 %)
--    Nach dem ersten Gespräch sagt kaum jemand sofort zu oder ab. Bisher gab es
--    dafuer keine Phase — der Lead blieb im Erstgespräch haengen oder wanderte
--    zu frueh auf "Angebot". Heisst bewusst NICHT nur "Follow-up": das gibt es
--    schon vor dem Erstgespräch, und in der Gesamtsicht wuerden beide sonst in
--    einer Spalte landen.
--
-- 2) KI: CHECK UND REPORT HEISSEN JETZT, WAS SIE SIND
--    Der Readiness-Check IST das Erstgespräch, sein Ergebnis IST der Masterplan,
--    der innerhalb von 48 Stunden rausgeht.
--      "Check gehalten"   → "KI-Masterplan erstellen"  (65 %)
--      "Report versendet" → "KI-Masterplan versendet"  (65 %)
--
-- Neue Reihenfolgen im Verkauf:
--   webdesign    Neu → Follow-up → Erstgespräch → Follow-up nach Erstgespräch
--                → Angebot → Gewonnen
--   performance  Neu → Follow-up → Analyse & Strategie → Erstgespräch
--                → Follow-up nach Erstgespräch → Angebot → Gewonnen
--   ki           Neu → Follow-up → Readiness-Check gebucht
--                → Follow-up nach Erstgespräch → KI-Masterplan erstellen
--                → KI-Masterplan versendet → Zweites Erstgespräch
--                → Angebot → Gewonnen
--
-- Auf (sparte, art, position) liegt eine Eindeutigkeitsregel, darum parken wir
-- jede Pipeline erst bei +100 und setzen danach die Zielpositionen.
-- =====================================================================

-- ---------- KI: Umbenennen ----------
update public.pipeline_stages set name = 'KI-Masterplan erstellen'
 where sparte='ki' and art='vertrieb' and name='Check gehalten';
update public.pipeline_stages set name = 'KI-Masterplan versendet'
 where sparte='ki' and art='vertrieb' and name='Report versendet';

-- ---------- Neue Phase in allen drei Bereichen ----------
insert into public.pipeline_stages (sparte, art, position, name, ist_abschluss)
select s.sparte, 'vertrieb', 900, 'Follow-up nach Erstgespräch', false
  from (values ('webdesign'), ('performance'), ('ki')) as s(sparte)
 where not exists (select 1 from public.pipeline_stages x
                    where x.sparte = s.sparte and x.art='vertrieb'
                      and x.name = 'Follow-up nach Erstgespräch');

-- ---------- Webdesign ----------
update public.pipeline_stages set position = position + 100 where sparte='webdesign' and art='vertrieb';
update public.pipeline_stages set position = 1 where sparte='webdesign' and art='vertrieb' and name='Neu';
update public.pipeline_stages set position = 2 where sparte='webdesign' and art='vertrieb' and name='Follow-up';
update public.pipeline_stages set position = 3 where sparte='webdesign' and art='vertrieb' and name='Erstgespräch';
update public.pipeline_stages set position = 4 where sparte='webdesign' and art='vertrieb' and name='Follow-up nach Erstgespräch';
update public.pipeline_stages set position = 5 where sparte='webdesign' and art='vertrieb' and name='Angebot';
update public.pipeline_stages set position = 6 where sparte='webdesign' and art='vertrieb' and name='Gewonnen';

-- ---------- Performance Marketing ----------
update public.pipeline_stages set position = position + 100 where sparte='performance' and art='vertrieb';
update public.pipeline_stages set position = 1 where sparte='performance' and art='vertrieb' and name='Neu';
update public.pipeline_stages set position = 2 where sparte='performance' and art='vertrieb' and name='Follow-up';
update public.pipeline_stages set position = 3 where sparte='performance' and art='vertrieb' and name='Analyse & Strategie';
update public.pipeline_stages set position = 4 where sparte='performance' and art='vertrieb' and name='Erstgespräch';
update public.pipeline_stages set position = 5 where sparte='performance' and art='vertrieb' and name='Follow-up nach Erstgespräch';
update public.pipeline_stages set position = 6 where sparte='performance' and art='vertrieb' and name='Angebot';
update public.pipeline_stages set position = 7 where sparte='performance' and art='vertrieb' and name='Gewonnen';

-- ---------- KI ----------
update public.pipeline_stages set position = position + 100 where sparte='ki' and art='vertrieb';
update public.pipeline_stages set position = 1 where sparte='ki' and art='vertrieb' and name='Neu';
update public.pipeline_stages set position = 2 where sparte='ki' and art='vertrieb' and name='Follow-up';
update public.pipeline_stages set position = 3 where sparte='ki' and art='vertrieb' and name='Readiness-Check gebucht';
update public.pipeline_stages set position = 4 where sparte='ki' and art='vertrieb' and name='Follow-up nach Erstgespräch';
update public.pipeline_stages set position = 5 where sparte='ki' and art='vertrieb' and name='KI-Masterplan erstellen';
update public.pipeline_stages set position = 6 where sparte='ki' and art='vertrieb' and name='KI-Masterplan versendet';
update public.pipeline_stages set position = 7 where sparte='ki' and art='vertrieb' and name='Zweites Erstgespräch';
update public.pipeline_stages set position = 8 where sparte='ki' and art='vertrieb' and name='Angebot';
update public.pipeline_stages set position = 9 where sparte='ki' and art='vertrieb' and name='Gewonnen';
