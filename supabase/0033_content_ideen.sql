-- =====================================================================
-- Flowstate — Rubriken, Funnel-Stufen und Ideen (Migration 0033)
--
-- DREI DINGE AUF EINMAL, weil sie zusammengehoeren:
--
-- 1) RUBRIK — worueber das Video geht
--    Pro Tag geht ein Lifestyle-Video raus und eins zum Fach (KI, Webdesign,
--    Performance Marketing). Das ist keine Kleinigkeit fuer die Statistik: wenn
--    an einem Tag zwei Fachvideos rausgehen und kein Lifestyle, ist die Woche
--    formal erfuellt, der Plan aber nicht eingehalten.
--
-- 2) FUNNEL-STUFE — wofuer das Video da ist
--    Nach dem Modell aus den beiden Quellen (digibrood, funnel.io), die sich
--    einig sind:
--      tofu     Aufmerksamkeit — gefunden werden. Reichweite, neue Zuschauer.
--      mofu     Erwaegung — Vertrauen. Fallbeispiele, Vorher-Nachher, Checklisten.
--      bofu     Entscheidung — zum Erstgespraech. Kundenstimmen, Ablauf, Preis.
--      bindung  Bestandskunden halten, Empfehlungen ausloesen.
--    Ohne diese Spalte laesst sich nicht sehen, ob alles nur Reichweite ist und
--    unten nichts ankommt — genau der Fehler, den beide Artikel beschreiben.
--
-- 3) IDEEN — der Weg vom Einfall zum fertigen Skript
--    vorschlag -> angenommen (Haken) -> Skript wird geschrieben
--              -> verworfen (X), bleibt aber stehen. Verworfene Ideen sind
--                 wertvoll: sie sagen, was NICHT gefaellt, und verhindern, dass
--                 dieselbe Idee in zwei Wochen nochmal vorgeschlagen wird.
-- =====================================================================

-- ------------------------------------------------- 1) Rubrik und Funnel

alter table public.content_posts add column if not exists rubrik text;
alter table public.content_posts add column if not exists funnel text;

alter table public.content_posts drop constraint if exists content_posts_rubrik_check;
alter table public.content_posts add constraint content_posts_rubrik_check
  check (rubrik is null or rubrik in ('lifestyle', 'ki', 'webdesign', 'performance'));

alter table public.content_posts drop constraint if exists content_posts_funnel_check;
alter table public.content_posts add constraint content_posts_funnel_check
  check (funnel is null or funnel in ('tofu', 'mofu', 'bofu', 'bindung'));

create index if not exists content_posts_rubrik_idx on public.content_posts (rubrik, veroeffentlicht_am desc);
create index if not exists content_posts_funnel_idx on public.content_posts (funnel, veroeffentlicht_am desc);

-- ------------------------------------------------- 2) Ziel YouTube auf 2

-- 1 Lifestyle-Video (was die Woche ueber lief) und 1 Fachvideo pro Woche.
update public.content_ziele set ziel = 2, geaendert = now()
 where kanal = 'YouTube Video';

-- ------------------------------------------------- 3) Ideen

create table if not exists public.content_ideen (
  id             bigserial primary key,
  marke          uuid not null references public.profiles(id) on delete cascade,

  -- Fuer welchen Kanal die Idee gedacht ist. Bei den Kurzvideos steht hier
  -- TikTok, weil dasselbe Video ohnehin auf alle drei Videokanaele geht — eine
  -- Idee dreimal vorzuschlagen waere nur Arbeit.
  kanal          text not null,
  rubrik         text check (rubrik is null or rubrik in ('lifestyle','ki','webdesign','performance')),
  funnel         text check (funnel is null or funnel in ('tofu','mofu','bofu','bindung')),

  titel          text not null,          -- der Aufhaenger in einem Satz
  idee           text not null,          -- worum es geht, was passiert
  warum          text,                   -- warum das funktioniert (Muster, Hook)
  beispiel_link  text,                   -- ein echtes Video als Beleg
  beispiel_quelle text,                  -- woher der Beleg kommt

  status         text not null default 'vorschlag'
                   check (status in ('vorschlag', 'angenommen', 'verworfen')),
  skript         text,                   -- entsteht erst beim Haken
  skript_am      timestamptz,

  -- Wenn aus der Idee ein Beitrag geworden ist, haengt er hier dran. So laesst
  -- sich spaeter fragen: welche Ideen wurden umgesetzt, und wie liefen sie?
  post_id        bigint references public.content_posts(id) on delete set null,

  entschieden_am timestamptz,
  entschieden_von uuid references public.profiles(id),
  erstellt       timestamptz not null default now(),
  quelle         text                    -- 'ki' | 'hand' — woher die Idee stammt
);

create index if not exists content_ideen_offen_idx
  on public.content_ideen (status, erstellt desc);
create index if not exists content_ideen_marke_idx
  on public.content_ideen (marke, kanal, status);

alter table public.content_ideen enable row level security;

drop policy if exists content_ideen_lesen on public.content_ideen;
create policy content_ideen_lesen on public.content_ideen for select using (true);
drop policy if exists content_ideen_schreiben on public.content_ideen;
create policy content_ideen_schreiben on public.content_ideen
  for all using (true) with check (true);

-- ------------------------------------------------- 4) Video und Zeitplanung
--
-- Die Datei selbst gehoert NICHT in die Datenbank — ein Short in guter Qualitaet
-- sind 50 bis 200 MB. Hier steht nur, wo sie liegt. Der Ablageort kommt, wenn
-- Supabase Storage eingerichtet ist; bis dahin bleibt die Spalte leer und der
-- Rest des Ablaufs funktioniert trotzdem.

alter table public.content_posts add column if not exists datei_pfad     text;
alter table public.content_posts add column if not exists datei_groesse  bigint;
-- Wann es rausgehen SOLL (Datum und Uhrzeit), im Gegensatz zu geplant_am (nur Tag).
alter table public.content_posts add column if not exists geplant_um     timestamptz;
alter table public.content_posts add column if not exists veroeff_status text
  check (veroeff_status is null or veroeff_status in ('wartet', 'laeuft', 'fertig', 'fehler'));
alter table public.content_posts add column if not exists veroeff_fehler text;

create index if not exists content_posts_geplant_um_idx
  on public.content_posts (geplant_um) where veroeff_status = 'wartet';

comment on column public.content_posts.geplant_um is
  'Zeitpunkt der geplanten Veröffentlichung. Braucht einen durchlaufenden Server — auf einem zugeklappten Laptop passiert nichts.';
comment on table public.content_ideen is
  'Ideen vom Vorschlag bis zum Skript. Verworfene bleiben stehen: sie sagen, was nicht gefällt, und verhindern Wiedervorlagen.';
