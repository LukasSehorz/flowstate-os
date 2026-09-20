-- =====================================================================
-- Flowstate — Das Auftragsbuch: public.auftraege
-- (Migration 0070, 19.09.2026)
--
-- Stufe 2 des Hermes-Neuaufbaus (Vault: projekte/2026-09-hermes-neuaufbau.md).
-- Jeder Auftrag an Hermes bekommt hier eine Nummer, eine Quelle, einen Status
-- und am Ende sein Ergebnis oder seinen Fehler. Bisher gab es das nicht: Ein
-- Auftrag war ein fetch() mit .catch(() => {}), und ob er je zurueckkam,
-- stand hoechstens im Sprachprotokoll.
--
-- Status: neu -> laeuft -> fertig | fehler | freigabe
--   freigabe = Hermes hat etwas vorbereitet, das nach REGELN.md ein Mensch
--   freigeben muss (freigabe_noetig im Ergebnis-JSON). Die Freigabe selbst
--   ist ein neuer Auftrag in derselben session_id.
--
-- Schreiben und Lesen laufen ueber die Systemverbindung (lib/crm.js system()),
-- weil auch Hintergrundlaeufe ohne angemeldeten Nutzer Auftraege anstossen.
-- RLS ist trotzdem an: Wer direkt an der Datenbank haengt, sieht nur als Admin.
-- =====================================================================

create table if not exists public.auftraege (
  id            bigserial primary key,
  quelle        text        not null default 'web',      -- web | telegram | stimme | cron | routine
  nutzer_id     uuid        null references public.profiles(id) on delete set null,
  text          text        not null,
  session_id    text        null,                        -- Hermes-Sitzung: gleicher Verlauf, Rueckfragen
  status        text        not null default 'neu',
  hermes_run_id text        null,
  ergebnis      jsonb       null,                        -- der JSON-Block aus SOUL.md
  antwort       text        null,                        -- Klartext daraus, wie Lukas ihn liest
  fehler        text        null,
  gestartet     timestamptz not null default now(),
  beendet       timestamptz null,
  dauer_ms      integer     null,
  constraint auftraege_status check (status in ('neu', 'laeuft', 'fertig', 'fehler', 'freigabe'))
);

create index if not exists idx_auftraege_status on public.auftraege(status);
create index if not exists idx_auftraege_gestartet on public.auftraege(gestartet desc);

alter table public.auftraege enable row level security;

drop policy if exists auftraege_admin on public.auftraege;
create policy auftraege_admin on public.auftraege
  for all using (public.ist_admin()) with check (public.ist_admin());
