-- =====================================================================
-- Flowstate CRM — Phase "Verloren" im Verkauf (Migration 0016)
--
-- Bisher konnte man einen Deal nur gewinnen. Sprang jemand beim Angebot ab,
-- blieb seine Karte fuer immer im Brett stehen: die Abschlussquote je Person
-- war geschoent und "Gescheiterte Deals" im Dashboard blieb dauerhaft leer.
--
-- Jede Verkaufspipeline bekommt darum hinter "Gewonnen" eine Spalte "Verloren".
-- Zieht man eine Karte dorthin, wird der Deal geschlossen und die Firma landet
-- unter Kunden → Verloren.
--
-- ist_verlust ist das Gegenstueck zu ist_abschluss. Wir erkennen die Phase
-- bewusst an diesem Kennzeichen und nicht am Namen — sonst haengt das Verhalten
-- an einer Zeichenkette, die jemand spaeter umbenennt.
-- =====================================================================

alter table public.pipeline_stages add column if not exists ist_verlust boolean not null default false;

insert into public.pipeline_stages (sparte, art, position, name, ist_abschluss, ist_verlust)
select s.sparte, 'vertrieb', s.pos, 'Verloren', false, true
  from (values ('webdesign', 7), ('performance', 8), ('ki', 10)) as s(sparte, pos)
 where not exists (select 1 from public.pipeline_stages x
                    where x.sparte = s.sparte and x.art = 'vertrieb' and x.ist_verlust);
