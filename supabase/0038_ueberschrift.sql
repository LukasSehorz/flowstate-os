-- =====================================================================
-- Flowstate — Ueberschrift je Idee und Video (Migration 0038)
--
-- Auf den Karten stand bisher der Aufhaenger als Ueberschrift:
--   "Ich habe unsere Telefon-KI mit dem breitesten Dialekt getestet, den ich
--    konnte"
-- Das ist der erste SATZ des Videos — richtig fuer die Aufnahme, aber zum
-- Wiedererkennen unbrauchbar. Auf einer Tafel mit zwanzig Kaertchen liest man
-- keine Saetze, man sucht ein Etikett.
--
-- Darum drei getrennte Dinge, jedes mit einer Aufgabe:
--
--   ueberschrift  3 bis 6 Woerter, das Etikett. "Dialekt-Test Telefon-KI"
--                 -> steht fett auf jeder Karte, vom Vorschlag bis online
--   titel/headline der erste Satz, woertlich gesprochen
--   idee          zwei bis vier Saetze, was passiert
--
-- Sie in ein Feld zu zwingen macht jedes davon schlechter: ein Etikett taugt
-- nicht als Hook, und ein Hook taugt nicht zum Scannen.
-- =====================================================================

alter table public.content_ideen add column if not exists ueberschrift text;
alter table public.content_posts add column if not exists ueberschrift text;

comment on column public.content_ideen.ueberschrift is
  'Kurzes Etikett, 3 bis 6 Wörter — zum Wiedererkennen auf der Karte. Nicht der Hook.';
comment on column public.content_posts.ueberschrift is
  'Kurzes Etikett, 3 bis 6 Wörter. Der Hook steht in headline, der Ablauf in notiz.';

-- Altbestand: bis das Modell echte Etiketten liefert, sind die ersten Woerter
-- des Aufhaengers das beste Verfuegbare. Besser als leere Karten.
update public.content_ideen
   set ueberschrift = left(regexp_replace(titel, '^\[Beispiel\]\s*', ''), 48)
 where ueberschrift is null;
update public.content_posts
   set ueberschrift = left(regexp_replace(titel, '^\[Beispiel\]\s*', ''), 48)
 where ueberschrift is null;
