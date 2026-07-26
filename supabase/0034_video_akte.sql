-- =====================================================================
-- Flowstate — Videoakte: Inhalt, Laenge, Link je Kanal (Migration 0034)
--
-- Bisher stand auf der Analyseseite nur der Titel und EIN Link. Das reicht
-- nicht: dasselbe Kurzvideo laeuft auf TikTok, YouTube Shorts und Instagram,
-- und jede Plattform hat ihre eigene URL. Mit einem einzigen Link-Feld muesste
-- man raten, welche der drei gemeint ist.
--
-- 1) INHALT — was im Video zu sehen war
--    Zwei, drei Saetze. Klingt nebensaechlich, ist es aber nicht: nach drei
--    Monaten sagt "Reel 47" nichts mehr, und ohne zu wissen, WAS drin war, ist
--    jede Zahl darunter wertlos. Man kann aus "+40 % Views" nur lernen, wenn
--    daneben steht, was anders gemacht wurde.
--
-- 2) LAENGE — wie lang das Video ging
--    Nicht zu verwechseln mit avg_sekunden (wie lang GESCHAUT wurde). Erst
--    beide zusammen ergeben die Aussage, die zaehlt: 12 von 15 Sekunden ist
--    stark, 12 von 90 Sekunden ist schwach. Dieselbe Zahl, zwei Welten.
--
-- 3) LINK JE KANAL
--    Eigene Tabelle statt drei Spalten, weil die Kanalliste wachsen kann und
--    weil ein Video nicht auf allen Kanaelen laufen muss. content_posts.link
--    bleibt bestehen (Altbestand) und wird beim Anzeigen als Rueckfall genutzt.
-- =====================================================================

alter table public.content_posts add column if not exists inhalt     text;
alter table public.content_posts add column if not exists laenge_sek integer
  check (laenge_sek is null or (laenge_sek > 0 and laenge_sek <= 60 * 60 * 6));

comment on column public.content_posts.inhalt is
  'Was im Video zu sehen war, zwei bis drei Sätze. Ohne das sind die Zahlen darunter nicht deutbar.';
comment on column public.content_posts.laenge_sek is
  'Länge des Videos in Sekunden. Nicht avg_sekunden — das ist, wie lange geschaut wurde.';

create table if not exists public.content_post_links (
  post_id   bigint not null references public.content_posts(id) on delete cascade,
  kanal     text   not null,
  url       text   not null,
  erstellt  timestamptz not null default now(),
  primary key (post_id, kanal)
);

create index if not exists content_post_links_post_idx
  on public.content_post_links (post_id);

alter table public.content_post_links enable row level security;

drop policy if exists content_post_links_lesen on public.content_post_links;
create policy content_post_links_lesen on public.content_post_links for select using (true);
drop policy if exists content_post_links_schreiben on public.content_post_links;
create policy content_post_links_schreiben on public.content_post_links
  for all using (true) with check (true);

-- Den vorhandenen Einzel-Link uebernehmen: er gilt fuer den ersten Kanal des
-- Videos. Besser als ihn zu verlieren, und beim naechsten Bearbeiten wird er
-- ohnehin richtig zugeordnet.
insert into public.content_post_links (post_id, kanal, url)
select p.id, p.kanaele[1], p.link
  from public.content_posts p
 where p.link is not null and p.link <> ''
   and p.kanaele is not null and array_length(p.kanaele, 1) >= 1
on conflict (post_id, kanal) do nothing;

comment on table public.content_post_links is
  'Ein Link je Kanal. Dasselbe Kurzvideo hat auf TikTok, YouTube Shorts und Instagram drei verschiedene URLs.';
