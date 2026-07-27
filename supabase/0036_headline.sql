-- =====================================================================
-- Flowstate — Headline je Video (Migration 0036)
--
-- Auf der Produktionstafel steht bisher nur der Titel. Der beschreibt das
-- THEMA ("Unsere Preise, offen ausgesprochen") — aber beim Drehen ist die
-- entscheidende Frage eine andere: Was ist der erste Satz? Der Aufhaenger
-- entscheidet, ob jemand nach zwei Sekunden weiterschaut, und er muss vor der
-- Aufnahme feststehen, nicht erst beim Schnitt.
--
-- Darum ein eigenes Feld statt den Titel dafuer zu missbrauchen: der Titel
-- ordnet ein (in Listen, in der Suche, in der Auswertung), die Headline ist
-- woertlich das, was gesagt wird. Beides in ein Feld zu zwingen hiesse, eines
-- von beidem schlechter zu machen.
--
-- Vorbelegt wird sie aus dem Titel der Idee — dort IST der Titel schon der
-- Aufhaenger. Aendern kann man sie danach jederzeit.
-- =====================================================================

alter table public.content_posts add column if not exists headline text;

comment on column public.content_posts.headline is
  'Der erste Satz des Videos, wörtlich. Nicht das Thema — das steht im Titel.';

-- Altbestand: der Titel ist bisher das Einzige, was da ist. Besser als leer,
-- und beim naechsten Bearbeiten wird es ohnehin praeziser.
update public.content_posts set headline = titel
 where headline is null and status <> 'veroeffentlicht';
