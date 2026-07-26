-- =====================================================================
-- Flowstate CRM — Anruf-Ergebnisse (Migration 0005)
-- Bisher stand das Ergebnis eines Cold Calls nur im Freitext der Aktivitaet.
-- Fuer die Anruf-Statistik (Calls / Erstgespraeche / Absagen / Spaeter nochmal /
-- Nicht erreicht, je Tag und je Branche) braucht es ein sauberes Feld.
-- Werte: gebucht | absage | nicht-erreicht | keine-zeit
-- =====================================================================

alter table public.aktivitaeten add column if not exists ergebnis text;

create index if not exists idx_aktivitaeten_anruf
  on public.aktivitaeten (art, zeit) where art = 'anruf';
create index if not exists idx_firmen_tags on public.firmen using gin (tags);
