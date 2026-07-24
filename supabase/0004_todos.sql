-- =====================================================================
-- Flowstate CRM — To-Dos (Migration 0004)
-- Die aufgaben-Tabelle gibt es schon (firma_id optional -> kundengebunden ODER
-- allgemein, titel, faellig = Deadline, erledigt). Ergaenzt wird nur der Tag,
-- an dem man die Aufgabe erledigen WILL ("geplant_am") — davon zieht sich
-- "Heute zu tun" die Aufgaben des Tages.
-- =====================================================================

alter table public.aufgaben add column if not exists geplant_am date;
alter table public.aufgaben add column if not exists notiz text;

create index if not exists idx_aufgaben_geplant on public.aufgaben(geplant_am);
create index if not exists idx_aufgaben_besitzer on public.aufgaben(besitzer);
