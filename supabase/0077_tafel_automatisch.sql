-- 0077 — Die Listen-Tafeln fuellen sich von selbst (20.09.2026)
--
-- Am 14.09. galt noch: "trotzdem soll man es immer selber aufs Whiteboard
-- eintragen muessen". Heute das Gegenteil, und zwar aus gutem Grund: Die
-- Tafeln sollen dasselbe zeigen wie die Umsatzuebersicht — jeden Posten, der
-- Geld bedeutet, und zwar in dem Monat, in dem er anfaellt. Von Hand
-- abzuschreiben, was das CRM ohnehin weiss, ist eine Fehlerquelle mit
-- Zusatzarbeit.
--
-- Zwei neue Spalten sagen, WOHER eine Zeile kommt:
--
--   herkunft = null           von Hand angelegt. Bleibt unangetastet, fuer
--                             immer. Niemand soll erleben, dass eine selbst
--                             geschriebene Zeile verschwindet.
--   herkunft = 'lead'         der Lead hat das Gespraech erreicht
--   herkunft = 'kunde-setup'  die einmalige Gebuehr eines Kunden
--   herkunft = 'kunde-monat'  ein Retainer-Monat; posten = '2026-10'
--
-- posten trennt die Monatszeilen desselben Kunden voneinander. Fuer alles
-- andere bleibt es leer — nicht null, damit der eindeutige Index greift
-- (in Postgres sind zwei NULL nie "gleich", zwei leere Texte schon).
alter table public.whiteboard_listenzeilen
  add column if not exists herkunft text,
  add column if not exists posten   text not null default '';

-- Eine Zeile je Posten. Der Index ist die eigentliche Wache: Er macht es
-- unmoeglich, dass ein zweiter Abgleich dieselbe Zeile noch einmal anlegt —
-- egal, wie oft er laeuft und wie viele Leute gleichzeitig die Tafel offen
-- haben. Von Hand angelegte Zeilen (herkunft is null) laesst er in Ruhe.
create unique index if not exists whiteboard_listenzeilen_posten_idx
  on public.whiteboard_listenzeilen (liste, firma_id, herkunft, posten)
  where herkunft is not null;

comment on column public.whiteboard_listenzeilen.herkunft is
  'null = von Hand angelegt; sonst lead | kunde-setup | kunde-monat (siehe listenAbgleichen).';
comment on column public.whiteboard_listenzeilen.posten is
  'Bei kunde-monat der Monat als YYYY-MM, sonst leer.';
