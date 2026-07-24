-- =====================================================================
-- Flowstate CRM — To-Dos im Dashboard + Erfolgsbonus (Migration 0011)
--
-- 1) aufgaben.wichtigkeit / .dringlichkeit
--    "Heute zu tun" im Dashboard sortiert nach Wichtigkeit in vier Spalten.
--    Damit ein To-Do aus der Kundenakte dort landet, braucht es diese Felder.
--    wichtigkeit: 1 = Sehr wichtig ... 4 = Kann warten (Standard 3)
--
-- 2) firmen.erfolgsbonus / .erfolgsbonus_text
--    Manche Auftraege haben eine Erfolgsvereinbarung ("3.000 EUR pro Mitarbeiter",
--    "200 EUR pro Lead"). Der Text haelt fest, wofuer genau wir was bekommen.
-- =====================================================================

alter table public.aufgaben add column if not exists wichtigkeit int not null default 3;
alter table public.aufgaben add column if not exists dringlichkeit text;

alter table public.firmen add column if not exists erfolgsbonus boolean;
alter table public.firmen add column if not exists erfolgsbonus_text text;
