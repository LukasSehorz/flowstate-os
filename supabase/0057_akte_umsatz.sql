-- 0057: Kundenakte in Kategorien & Zeilen, geschaetzter und geplanter Umsatz.
--
-- Warum (05.09.2026, Lukas): "Das CRM ist zu unuebersichtlich, vor allem wenn
-- man einen Kunden anlegt. Zu viele Felder." Die Akte zeigt ab jetzt nur noch
-- Pflichtzeilen und Zeilen mit Wert; alles andere blendet man je Kategorie
-- selbst ein. Diese Wahl muss die Seite ueberleben, sonst waehlt man sie bei
-- jedem Oeffnen neu — darum liegt sie an der Firma (akte_zeilen).
--
-- Zwei neue Geldzahlen, die es bisher nicht gab:
--   umsatz_geschaetzt  Bauchgefuehl beim Anlegen ("da sind wohl 3.000 drin").
--   umsatz_geplant     Der fest besprochene Preis, bevor eine Rechnung steht.
-- Beide sind PIPELINE, kein Umsatz: Sie zaehlen im Pipeline-Volumen, bis die
-- erste Rechnung gestellt ist (siehe crm.pipelineVolumen). Der bestehende
-- Umsatz aus gewonnenen Deals bleibt unangetastet.
--
-- Wiederholbar: add column if not exists. Nichts wird geloescht.

alter table public.firmen add column if not exists umsatz_geschaetzt numeric(12,2);
alter table public.firmen add column if not exists umsatz_geplant    numeric(12,2);

-- Welche optionalen Zeilen je Kategorie eingeblendet sind, z. B.
--   {"kontakt":["mobil","website"],"firma":["mitarbeiter_zahl"]}
-- Leer = nur Pflichtzeilen und Zeilen mit Wert. Der Server prueft die Namen
-- gegen die Zeilenliste in lib/crm-akte.js, bevor er hier schreibt.
alter table public.firmen add column if not exists akte_zeilen jsonb not null default '{}'::jsonb;

comment on column public.firmen.umsatz_geschaetzt is 'Geschaetzter Umsatz (Bauchgefuehl) — zaehlt im Pipeline-Volumen, bis eine Rechnung gestellt ist';
comment on column public.firmen.umsatz_geplant    is 'Geplanter Umsatz (fest besprochener Preis) — zaehlt im Pipeline-Volumen, bis eine Rechnung gestellt ist';
comment on column public.firmen.akte_zeilen       is 'Eingeblendete optionale Zeilen je Kategorie der Kundenakte (jsonb, Kategorie -> [Zeilennamen])';
