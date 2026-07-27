-- =====================================================================
-- Flowstate — Warum eine Idee verworfen wurde (Migration 0039)
--
-- Verworfene Ideen bleiben stehen — das war von Anfang an so. Was fehlte: sie
-- sind ZWEI verschiedene Dinge, die bisher in einen Topf fielen.
--
--   hand     Jannik hat X gedrückt. Die Idee taugt nichts, oder passt nicht.
--            Sie soll nicht wiederkommen.
--
--   ersetzt  Der Abendlauf hat sie aussortiert, weil an dem Tag etwas
--            Stärkeres kam. Sie war NICHT schlecht — sie war nur die
--            schwächere von zweien. Das ist der interessante Fall: wenn
--            später mehr produziert werden kann, ist genau dieser Stapel
--            der Vorrat, aus dem man schöpft.
--
-- Die beiden gleich zu behandeln hiesse, gute Ideen mit abgelehnten zu
-- begraben. Darum die Spalte.
--
-- Bisher stand der Vermerk als angehängter Text in "warum" ("[Ersetzt am …]") —
-- das war eine Notloesung, nicht abfragbar und nicht filterbar.
-- =====================================================================

alter table public.content_ideen add column if not exists verworfen_art text
  check (verworfen_art is null or verworfen_art in ('hand', 'ersetzt'));

comment on column public.content_ideen.verworfen_art is
  'hand = von Hand abgelehnt · ersetzt = vom Abendlauf zugunsten einer stärkeren aussortiert. Nur bei status = verworfen gesetzt.';

-- Altbestand: was den Ersetzt-Vermerk im Text trägt, war der Abendlauf.
update public.content_ideen
   set verworfen_art = 'ersetzt'
 where status = 'verworfen' and verworfen_art is null and warum like '%[Ersetzt am%';

update public.content_ideen
   set verworfen_art = 'hand'
 where status = 'verworfen' and verworfen_art is null;

create index if not exists content_ideen_verworfen_idx
  on public.content_ideen (marke, verworfen_art, entschieden_am desc)
  where status = 'verworfen';
