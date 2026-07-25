-- =====================================================================
-- Flowstate CRM — Pipeline-Phasen nach dem echten Ablauf (Migration 0013)
--
-- Die Phasen hiessen bisher teils anders, als tatsaechlich gearbeitet wird.
-- Diese Migration bringt sie in die Reihenfolge des Ablaufs. Umbenennen und
-- Umsortieren ist gefahrlos: Deals und Projekte haengen an der Id, nicht am
-- Namen, und wandern deshalb einfach mit.
--
-- VERKAUF
--   webdesign    unveraendert: Neu → Follow-up → Erstgespräch → Angebot → Gewonnen
--   performance  "Analyse & Strategie" rutscht VOR das Erstgespräch: erst
--                analysieren und eine Strategie bauen, dann damit ins Gespräch.
--   ki           nach "Report versendet" kommt ein zweites Gespräch, in dem der
--                Maßnahmenplan besprochen wird — davor gab es dafuer keine Phase.
--
-- PROJEKTABWICKLUNG
--   webdesign    kein Onboarding/Briefing mehr, sondern der echte Weg:
--                Entwurf bauen → zeigen → Änderungen → Freigabe → Live → Wartung.
--                "Wartung" schliesst das Projekt ab (ist_abschluss) — ab da ist
--                es laufende Betreuung und verschwindet vom Brett.
--   performance  Creatives entstehen VOR dem Setup.
--   ki           "Pilot läuft" heisst jetzt "Umsetzung Pilot" — die Phase ist
--                das Bauen des Piloten, nicht das Zuschauen.
-- =====================================================================

-- Auf (sparte, art, position) liegt eine Eindeutigkeitsregel. Beim Umsortieren
-- wuerden sich zwei Phasen kurzzeitig dieselbe Position teilen, darum parken wir
-- die betroffene Pipeline erst bei +100 und setzen danach die Zielpositionen.

-- ---------- Verkauf: Performance Marketing ----------
update public.pipeline_stages set position = position + 100 where sparte='performance' and art='vertrieb';
update public.pipeline_stages set position = 1 where id = 12;  -- Neu
update public.pipeline_stages set position = 2 where id = 13;  -- Follow-up
update public.pipeline_stages set position = 3 where id = 15;  -- Analyse & Strategie
update public.pipeline_stages set position = 4 where id = 14;  -- Erstgespräch
update public.pipeline_stages set position = 5 where id = 16;  -- Angebot
update public.pipeline_stages set position = 6 where id = 17;  -- Gewonnen

-- ---------- Verkauf: KI ----------
update public.pipeline_stages set position = position + 100 where sparte='ki' and art='vertrieb';
update public.pipeline_stages set position = 1 where id = 24;  -- Neu
update public.pipeline_stages set position = 2 where id = 25;  -- Readiness-Check gebucht
update public.pipeline_stages set position = 3 where id = 26;  -- Check gehalten
update public.pipeline_stages set position = 4 where id = 27;  -- Report versendet
update public.pipeline_stages set position = 6 where id = 28;  -- Angebot
update public.pipeline_stages set position = 7 where id = 29;  -- Gewonnen
insert into public.pipeline_stages (sparte, art, position, name, ist_abschluss)
select 'ki', 'vertrieb', 5, 'Zweites Erstgespräch', false
 where not exists (select 1 from public.pipeline_stages
                    where sparte='ki' and art='vertrieb' and name='Zweites Erstgespräch');

-- ---------- Projekt: Webdesign ----------
update public.pipeline_stages set name = 'Designvorschlag erstellen' where id = 6;
update public.pipeline_stages set name = 'Entwurf vorgestellt'       where id = 7;
update public.pipeline_stages set name = 'Änderungswünsche umsetzen' where id = 8;
update public.pipeline_stages set ist_abschluss = true               where id = 11; -- Wartung

-- ---------- Projekt: Performance Marketing ----------
update public.pipeline_stages set position = position + 100 where sparte='performance' and art='projekt';
update public.pipeline_stages set position = 1 where id = 18;  -- Onboarding
update public.pipeline_stages set position = 2 where id = 20;  -- Creatives
update public.pipeline_stages set position = 3 where id = 19;  -- Setup (Konten, Tracking)
update public.pipeline_stages set position = 4 where id = 21;  -- Kampagne live
update public.pipeline_stages set position = 5 where id = 22;  -- Optimierung
update public.pipeline_stages set position = 6 where id = 23;  -- Reporting

-- ---------- Projekt: KI ----------
update public.pipeline_stages set name = 'Umsetzung Pilot' where id = 32;
