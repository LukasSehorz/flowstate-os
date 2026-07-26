-- =====================================================================
-- Flowstate — Kennzahlen je Video (Migration 0032)
--
-- Ein Stueck Content laeuft auf mehreren Kanaelen und wird zu mehreren
-- Zeitpunkten gemessen. Der Schluessel ist darum dreiteilig:
--
--   (post_id, kanal, messpunkt)
--
-- Warum alle drei:
--   post_id    Dasselbe Video, aber
--   kanal      auf TikTok laeuft es anders als auf Instagram — eine gemeinsame
--              Zahl waere wertlos.
--   messpunkt  Nach 24 Stunden sieht ein Video anders aus als nach einer Woche.
--              Genau dieser Unterschied ist die Aussage: was zieht sofort, was
--              zieht nach. Eine einzige "aktuelle" Zahl wuerde das verschlucken.
--
-- MESSPUNKTE
--   '24h'      einen Tag nach Veroeffentlichung
--   '7t'       eine Woche danach
--   'aktuell'  laufender Stand, ueberschreibbar (fuer YouTube, das dauerhaft laeuft)
--
-- WELCHE ZAHLEN
--
-- Bewusst nur die, die es bei den Plattformen tatsaechlich je Video gibt.
-- Nicht aufgenommen, obwohl gewuenscht:
--   - Demografie je Video (Geschlecht, Bundesland): gibt es bei keiner der vier
--     Plattformen je Video, nur auf Kanalebene.
--   - Sekundenschwellen (0,5s / 1s / 15s): liefert keine Schnittstelle. Was es
--     gibt, ist die Durchschnittsdauer und die Rate "bis zum Ende" — beide sind
--     unten drin.
-- Eine Spalte anzulegen, die nie befuellt werden kann, waere eine Zusage, die
-- das System nicht halten kann.
--
-- website_klicks ist der Sonderfall: den weiss keine Plattform, aber WIR koennen
-- ihn messen, wenn je Video ein eigener Link verwendet wird.
-- =====================================================================

create table if not exists public.content_zahlen (
  id             bigserial primary key,
  post_id        bigint not null references public.content_posts(id) on delete cascade,
  kanal          text   not null,
  messpunkt      text   not null default 'aktuell'
                   check (messpunkt in ('24h', '7t', 'aktuell')),

  -- Reichweite und Reaktion
  views          bigint,
  likes          integer,
  kommentare     integer,
  shares         integer,
  saves          integer,

  -- Was daraus wurde
  profilaufrufe  integer,
  neue_abos      integer,
  website_klicks integer,

  -- Wie lange geschaut wurde. Prozentwerte, weil die Plattformen es so liefern.
  avg_sekunden   numeric(7,2),
  bis_ende_proz  numeric(5,2) check (bis_ende_proz is null or (bis_ende_proz >= 0 and bis_ende_proz <= 100)),

  notiz          text,
  gemessen_am    timestamptz not null default now(),
  erfasst_von    uuid references public.profiles(id),

  unique (post_id, kanal, messpunkt)
);

create index if not exists content_zahlen_post_idx  on public.content_zahlen (post_id, kanal);
create index if not exists content_zahlen_zeit_idx  on public.content_zahlen (gemessen_am desc);

alter table public.content_zahlen enable row level security;

drop policy if exists content_zahlen_lesen on public.content_zahlen;
create policy content_zahlen_lesen on public.content_zahlen for select using (true);
drop policy if exists content_zahlen_schreiben on public.content_zahlen;
create policy content_zahlen_schreiben on public.content_zahlen
  for all using (true) with check (true);

-- Der genaue Veroeffentlichungszeitpunkt. Bisher gab es nur den Tag; fuer
-- "24 Stunden danach" ist das grob genug, aber sobald die Zahlen automatisch
-- geholt werden, braucht es die Uhrzeit. Wird jetzt schon mitgeschrieben, damit
-- die Altbestaende spaeter nicht fehlen.
alter table public.content_posts
  add column if not exists veroeffentlicht_um timestamptz;

comment on table public.content_zahlen is
  'Kennzahlen je Video, Kanal und Messzeitpunkt. Bewusst nur Werte, die die Plattformen je Video tatsächlich herausgeben.';
comment on column public.content_zahlen.website_klicks is
  'Klicks auf unsere Seite aus diesem Video. Weiß keine Plattform — messen wir selbst über einen eigenen Link je Video.';
