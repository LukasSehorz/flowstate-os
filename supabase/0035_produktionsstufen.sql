-- =====================================================================
-- Flowstate — Produktionsstufen: die Tafel von der Idee bis online (0035)
--
-- Bisher waren die Stufen: idee -> entwurf -> geplant -> veroeffentlicht.
-- Das beschreibt einen Redaktionsplan, aber NICHT die Arbeit. Zwischen
-- "Entwurf" und "Geplant" liegen zwei Schritte, die echte Zeit kosten und an
-- denen Dinge liegen bleiben: aufnehmen und schneiden. Wenn beide unsichtbar
-- unter "Entwurf" verschwinden, sieht man nicht, WO der Stau ist — und genau
-- das ist die Frage beim Vorproduzieren.
--
-- Neue Stufen (das sind die Spalten der Tafel):
--   aufnehmen        Skript liegt vor, Video muss noch gedreht werden
--   schneiden        gedreht, muss geschnitten werden
--   hochladen        geschnitten, Datei und Termin fehlen noch
--   geplant          Datei da, Termin gesetzt, wartet auf die Uhr
--   veroeffentlicht  ist online
--
-- 'idee' und 'entwurf' bleiben ERLAUBT, aber nur fuer Altbestand. Neue
-- Eintraege aus der Ideenwerkstatt starten bei 'aufnehmen'. Die alten Werte zu
-- verbieten wuerde bestehende Zeilen unrettbar machen; sie stillschweigend
-- umzuschreiben waere genauso falsch, weil 'entwurf' nicht dasselbe bedeutet.
-- Darum: erlauben, aber in der Anzeige zu 'aufnehmen' zusammenfassen.
-- =====================================================================

alter table public.content_posts drop constraint if exists content_posts_status_check;
alter table public.content_posts add constraint content_posts_status_check
  check (status in ('idee', 'entwurf',
                    'aufnehmen', 'schneiden', 'hochladen',
                    'geplant', 'veroeffentlicht'));

-- Altbestand auf die neue Sprache heben: ein Entwurf ist etwas, das noch
-- gedreht werden muss.
update public.content_posts set status = 'aufnehmen' where status = 'entwurf';

-- Reihenfolge innerhalb einer Spalte. Ohne das waere die Sortierung auf der
-- Tafel zufaellig und ein verschobenes Kaertchen springt beim Neuladen an eine
-- andere Stelle — nichts zerstoert Vertrauen in ein Board schneller.
alter table public.content_posts add column if not exists reihe integer;

-- Wann die Stufe zuletzt gewechselt hat. Damit laesst sich beantworten, was
-- liegen bleibt: "seit neun Tagen in Schneiden" ist eine Aussage, "in
-- Schneiden" ist keine.
alter table public.content_posts add column if not exists stufe_seit timestamptz default now();
update public.content_posts set stufe_seit = coalesce(stufe_seit, erstellt, now())
 where stufe_seit is null;

create index if not exists content_posts_tafel_idx
  on public.content_posts (marke, status, geplant_am);

comment on column public.content_posts.reihe is
  'Reihenfolge innerhalb der Spalte auf der Produktionstafel.';
comment on column public.content_posts.stufe_seit is
  'Seit wann der Eintrag in dieser Stufe liegt — zeigt, was liegen bleibt.';
