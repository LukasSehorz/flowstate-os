-- =====================================================================
-- Flowstate — Wer welchen Bereich überhaupt öffnen darf (Migration 0046)
--
-- Warum (29.07.2026): Simon und Ioannis bekommen eigene Zugänge. Die
-- Zeilenrechte (0002_rls.sql) regeln schon, WELCHE Datensätze jemand sieht —
-- ein Mitarbeiter sieht nur, wofür er als besitzer eingetragen ist. Was sie
-- NICHT regeln: welche BEREICHE überhaupt auftauchen.
--
-- Ohne das stünden Buchhaltung, Lead-Maschine und Wissen in der Navigation,
-- und jeder Klick liefe in eine leere Seite oder eine Weiterleitung. Das ist
-- kein Datenleck, aber es zeigt jedem, was es alles gibt — und lädt zum
-- Ausprobieren ein.
--
-- module = Liste der Bereiche, die diese Person öffnen darf.
--   Für Admins ist die Liste bedeutungslos: die Geschäftsführung sieht alles,
--   geprüft über rolle = 'admin'. So funktioniert ein neuer Admin sofort,
--   ohne dass jemand daran denken muss, ihm Bereiche einzutragen.
--
-- Die Liste ist nur die halbe Miete. Sie blendet die Navigation aus UND wird
-- bei jedem Aufruf geprüft (Torwächter in server.js) — sonst käme man mit
-- einer getippten Adresse trotzdem hinein.
-- =====================================================================

alter table public.profiles
  add column if not exists module text[] not null default '{}';

comment on column public.profiles.module is
  'Bereiche, die diese Person öffnen darf (zentrale, kalender, todos, crm, marketing, content …). '
  'Für rolle = ''admin'' ohne Bedeutung — die Geschäftsführung sieht alles.';

-- Der Grundstock für Mitarbeitende: eigene Zentrale mit Kalender und To-Dos,
-- dazu Kunden & CRM. Alles darin bleibt auf die eigenen Datensätze begrenzt.
update public.profiles
   set module = array['zentrale','kalender','todos','crm']
 where rolle <> 'admin' and module = '{}';

-- Ioannis betreut zusätzlich Marketing und Content.
update public.profiles
   set module = array['zentrale','kalender','todos','crm','marketing','content']
 where name = 'Ioannis';
