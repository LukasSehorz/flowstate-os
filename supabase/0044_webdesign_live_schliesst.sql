-- =====================================================================
-- Flowstate — bei Webdesign ist LIVE der Abschluss (Migration 0044)
--
-- Warum (28.07.2026): Die Projektabwicklung für Webdesign hatte sechs Spalten,
-- die letzte hiess "Wartung" und galt als Abschluss. Das bildet den Ablauf
-- nicht ab: Wenn die Seite live ist, ist das Projekt fertig. Wartung ist kein
-- Projektschritt, sondern was danach dauerhaft läuft — sie gehört nicht als
-- Spalte auf ein Brett, auf dem Arbeit von links nach rechts wandert und
-- irgendwann herunterfällt.
--
-- Ab jetzt:
--   … → Kundenfreigabe → Live   und mit Live ist das Projekt abgeschlossen.
--
-- Projekte, die auf "Wartung" standen, wandern auf "Live" und gelten als
-- fertig — sie waren es faktisch schon.
--
-- Performance Marketing und KI-Projekte bleiben unverändert: dort ist
-- "Reporting" bzw. "Großprojekt" laufende Arbeit und kein Abschluss. Wenn das
-- auch geschlossen werden soll, ist das eine eigene Entscheidung.
-- =====================================================================

-- 1. Erst die Projekte von Wartung auf Live umhängen, sonst blockiert der
--    Fremdschlüssel das Löschen der Stufe.
update public.projekte p
   set stufe_id = (select id from public.pipeline_stages
                    where sparte = 'webdesign' and art = 'projekt' and name = 'Live'),
       status = 'fertig'
 where p.stufe_id in (select id from public.pipeline_stages
                       where sparte = 'webdesign' and art = 'projekt' and name = 'Wartung');

-- 2. "Live" wird die Abschluss-Stufe.
update public.pipeline_stages set ist_abschluss = true
 where sparte = 'webdesign' and art = 'projekt' and name = 'Live';

-- 3. "Wartung" verschwindet als Spalte.
delete from public.pipeline_stages
 where sparte = 'webdesign' and art = 'projekt' and name = 'Wartung';
