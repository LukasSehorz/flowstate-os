-- =====================================================================
-- Flowstate — Content nach Personal-Brand trennen (Migration 0029)
--
-- Jannik und Lukas produzieren beide Content, aber auf ZWEI GETRENNTEN
-- Accounts. Ein Post gehoert also immer zu einer Marke, und die Uebersicht muss
-- sich danach filtern lassen — sonst mischen sich zwei Redaktionsplaene zu
-- einem unbrauchbaren Haufen.
--
-- WARUM EINE EIGENE SPALTE UND NICHT "besitzer"
--
-- besitzer sagt, WER den Post macht. marke sagt, AUF WELCHEM ACCOUNT er
-- rausgeht. Das ist meistens dieselbe Person, aber eben nicht immer: Lukas kann
-- einen Post fuer Janniks Kanal schreiben. Beides in eine Spalte zu quetschen
-- waere genau so lange bequem, bis es das erste Mal auseinandergeht.
--
-- Die Marke zeigt auf profiles — die Namen stehen damit an einer Stelle. Kaeme
-- spaeter ein Firmen-Account dazu, der keiner Person gehoert, braucht es eine
-- eigene Marken-Tabelle; fuer zwei Personal-Brands waere die heute nur Ballast.
-- =====================================================================

alter table public.content_posts
  add column if not exists marke uuid references public.profiles(id);

-- Bestand: bisher gab es nur eine Sicht, darum gilt der Ersteller als Marke.
update public.content_posts set marke = besitzer where marke is null;

create index if not exists content_posts_marke_idx
  on public.content_posts (marke, status, geplant_am);

comment on column public.content_posts.marke is
  'Auf welchem Personal-Brand-Account der Post rausgeht. Nicht zwingend derselbe wie besitzer (wer ihn macht).';
