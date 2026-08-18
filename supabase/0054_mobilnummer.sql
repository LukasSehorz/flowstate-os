-- =====================================================================
-- Flowstate — Handynummer neben der Festnetznummer (Migration 0054)
--
-- Gemeldet am 18.08.2026: Die Liste "Leads_GF-Handy_Bayern" kam mit lauter
-- Strichen in der Telefonspalte herein. Der Grund lag in der
-- Spaltenerkennung: Sie vergleicht Kopfzeilen mit "beginnt mit" gegen eine
-- Wortliste, in der weder "Handy" noch "Festnetz" stand. "HANDY GF" faengt
-- nicht mit "tel" an und "Festnetz" nicht mit "nummer" — also wurden BEIDE
-- Telefonspalten stillschweigend verworfen. Angelegt wurden die Leads
-- trotzdem, weil Firmenname, Ort, PLZ und Website erkannt wurden.
--
-- Fachlich sind es zwei verschiedene Nummern, keine Alternativen: Beim
-- Kaltakquise-Anruf entscheidet, ob man den Geschaeftsfuehrer direkt am Handy
-- hat oder in der Zentrale landet. Deshalb eine eigene Spalte statt "nimm die
-- erste, die da ist".
--
-- Der Index sitzt auf mobil, weil leadsAnlegen beim Import gegen beide
-- Nummern auf Doppelte prueft — sonst waere das ein Durchlauf durch die
-- ganze Tabelle je importierter Zeile.
-- =====================================================================

alter table public.firmen add column if not exists mobil text;

create index if not exists idx_firmen_mobil on public.firmen(mobil)
  where mobil is not null;
