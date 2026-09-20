-- =====================================================================
-- Flowstate — KI-Projekte: neue Phasen im Verkauf und in der
-- Projektabwicklung (Migration 0069, 14.09.2026, Vorgabe von Lukas)
--
-- VERKAUF, neu in dieser Reihenfolge:
--   1 Neu · 2 Follow-up · 3 Setting Call · 4 KI-Workshop
--   5 KI-Masterplan versendet · 6 Sales-Call · 7 Follow-up nach Sales-Call
--   8 Gewonnen · 9 Verloren
--
-- PROJEKTABWICKLUNG, neu:
--   1 Onboarding · 2 Umsetzung · 3 Feedback · 4 Übergabe · 5 Live
--   "Live" ist die Abschluss-Stufe: das Projekt faellt vom Brett, und der
--   Kunde wird Retainer-Kunde (Betreuung) — das erledigt der Code in
--   lib/crm.js (projektVerschieben / projektStufeSetzen), nicht diese Datei.
--
-- Umbenannt wird ueber den NAMEN, nicht ueber die id: Die Zeilen behalten
-- ihre id, also bleiben alle Karten, die schon darauf stehen, wo sie sind.
--   Readiness-Check gebucht   -> Setting Call              (3 offene Deals)
--   KI-Masterplan erstellen   -> KI-Workshop
--   Zweites Erstgespräch      -> Sales-Call
--   Angebot                   -> Follow-up nach Sales-Call
--   Audit läuft               -> Onboarding
--   Umsetzung Pilot           -> Umsetzung
--   Fahrplan & Report         -> Feedback
--   Großprojekt               -> Live (wird Abschluss-Stufe)
--
-- "Follow-up nach Erstgespräch" gibt es im KI-Verkauf nicht mehr. Die Karten
-- darin (am 14.09.: Linda Bau, West-Garage Heinz Buchenroth) hatten ihr
-- erstes Gespraech schon — sie wandern in den Setting Call, nicht weiter nach
-- vorn. Webdesign behaelt seine eigene Phase gleichen Namens.
--
-- Wiederholbar: Ein zweiter Lauf findet keine alten Namen mehr, schiebt die
-- Positionen noch einmal hoch und setzt sie wieder auf dieselben Werte.
-- =====================================================================

-- ------------------------------------------------------------ Verkauf
-- (sparte, art, position) ist eindeutig. Erst alles weit nach hinten, damit
-- das Neu-Nummerieren unten nirgends auf eine besetzte Position trifft.
update public.pipeline_stages set position = position + 1000
 where sparte = 'ki' and art = 'vertrieb' and position < 1000;

update public.deals d set stufe_id = ziel.id
  from public.pipeline_stages alt, public.pipeline_stages ziel
 where d.stufe_id = alt.id
   and alt.sparte = 'ki' and alt.art = 'vertrieb' and alt.name = 'Follow-up nach Erstgespräch'
   and ziel.sparte = 'ki' and ziel.art = 'vertrieb'
   and ziel.name in ('Readiness-Check gebucht', 'Setting Call');

delete from public.pipeline_stages s
 where s.sparte = 'ki' and s.art = 'vertrieb' and s.name = 'Follow-up nach Erstgespräch'
   and not exists (select 1 from public.deals d where d.stufe_id = s.id);

update public.pipeline_stages set name = 'Setting Call'
 where sparte = 'ki' and art = 'vertrieb' and name = 'Readiness-Check gebucht';
update public.pipeline_stages set name = 'KI-Workshop'
 where sparte = 'ki' and art = 'vertrieb' and name = 'KI-Masterplan erstellen';
update public.pipeline_stages set name = 'Sales-Call'
 where sparte = 'ki' and art = 'vertrieb' and name = 'Zweites Erstgespräch';
update public.pipeline_stages set name = 'Follow-up nach Sales-Call'
 where sparte = 'ki' and art = 'vertrieb' and name = 'Angebot';

with soll(name, pos) as (values
  ('Neu', 1), ('Follow-up', 2), ('Setting Call', 3), ('KI-Workshop', 4),
  ('KI-Masterplan versendet', 5), ('Sales-Call', 6), ('Follow-up nach Sales-Call', 7),
  ('Gewonnen', 8), ('Verloren', 9))
update public.pipeline_stages s set position = soll.pos
  from soll
 where s.sparte = 'ki' and s.art = 'vertrieb' and s.name = soll.name;

-- Fehlt eine Phase ganz (etwa auf einer frisch aufgesetzten Datenbank), wird
-- sie angelegt — auf ihrer Position, die oben frei geblieben ist.
insert into public.pipeline_stages (sparte, art, position, name, ist_abschluss, ist_verlust)
select 'ki', 'vertrieb', soll.pos, soll.name, soll.name = 'Gewonnen', soll.name = 'Verloren'
  from (values
    ('Neu', 1), ('Follow-up', 2), ('Setting Call', 3), ('KI-Workshop', 4),
    ('KI-Masterplan versendet', 5), ('Sales-Call', 6), ('Follow-up nach Sales-Call', 7),
    ('Gewonnen', 8), ('Verloren', 9)) as soll(name, pos)
 where not exists (select 1 from public.pipeline_stages s
                    where s.sparte = 'ki' and s.art = 'vertrieb' and s.name = soll.name);

-- -------------------------------------------------- Projektabwicklung
update public.pipeline_stages set position = position + 1000
 where sparte = 'ki' and art = 'projekt' and position < 1000;

update public.pipeline_stages set name = 'Onboarding'
 where sparte = 'ki' and art = 'projekt' and name = 'Audit läuft';
update public.pipeline_stages set name = 'Umsetzung'
 where sparte = 'ki' and art = 'projekt' and name = 'Umsetzung Pilot';
update public.pipeline_stages set name = 'Feedback'
 where sparte = 'ki' and art = 'projekt' and name = 'Fahrplan & Report';
update public.pipeline_stages set name = 'Live'
 where sparte = 'ki' and art = 'projekt' and name = 'Großprojekt';

with soll(name, pos) as (values
  ('Onboarding', 1), ('Umsetzung', 2), ('Feedback', 3), ('Übergabe', 4), ('Live', 5))
update public.pipeline_stages s
   set position = soll.pos, ist_abschluss = (soll.name = 'Live'), ist_verlust = false
  from soll
 where s.sparte = 'ki' and s.art = 'projekt' and s.name = soll.name;

insert into public.pipeline_stages (sparte, art, position, name, ist_abschluss, ist_verlust)
select 'ki', 'projekt', soll.pos, soll.name, soll.name = 'Live', false
  from (values ('Onboarding', 1), ('Umsetzung', 2), ('Feedback', 3), ('Übergabe', 4), ('Live', 5))
       as soll(name, pos)
 where not exists (select 1 from public.pipeline_stages s
                    where s.sparte = 'ki' and s.art = 'projekt' and s.name = soll.name);
