-- =====================================================================
-- Flowstate CRM — Aufgaben als Oberkategorien (Migration 0018)
--
-- Die Einzelaufgaben aus 0017 bleiben erhalten (sie erklaeren im Tooltip, was
-- hinter einer Kategorie steckt), auf der Personenseite steht aber nur noch die
-- Oberkategorie. 21 Marken nebeneinander liest niemand — fuenf bis sieben schon.
--
-- Kategorien: Vertrieb · Marketing · Content · Umsetzung · Kunden ·
--             Buchhaltung · Führung
-- =====================================================================

alter table public.profiles add column if not exists kategorien text[] not null default '{}';

update public.profiles set kategorien = array['Vertrieb']
 where name ilike 'Simon%';

update public.profiles set kategorien = array['Vertrieb', 'Umsetzung', 'Content']
 where name ilike 'Ioannis%';

update public.profiles set kategorien = array['Marketing']
 where name ilike 'Louis%';

update public.profiles set kategorien =
  array['Vertrieb', 'Marketing', 'Content', 'Umsetzung', 'Kunden', 'Buchhaltung', 'Führung']
 where name ilike 'Jannik%' or name ilike 'Lukas%';
