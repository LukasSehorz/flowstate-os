-- =====================================================================
-- Flowstate CRM — Termine, Dringlichkeit und Kartenreihenfolge (Migration 0012)
--
-- 1) firmen.dringlichkeit
--    Vier Stufen: Sehr dringend | Dringend | Bald | Kann warten.
--    Steht als Streifen + Kuerzel auf jeder Pipeline-Karte, damit man auf
--    einen Blick sieht, was zuerst drankommt. Liegt bewusst auf der FIRMA
--    und nicht auf dem Deal: dieselbe Dringlichkeit gilt im Verkauf und
--    spaeter in der Projektabwicklung, ohne dass man sie neu setzen muss.
--
-- 2) firmen.erstgespraech_am / .faellig_am
--    Auf der Karte steht ein Datum. Solange der Deal in der Erstgespraechs-
--    Stufe haengt: "Erstgespräch am <Datum>". Sobald er weitergezogen wird:
--    "fällig bis <Datum>".
--
-- 3) firmen.naechster_termin / .naechste_aufgabe
--    Der naechste konkrete Schritt ("Webseite live stellen", 30.08.) —
--    steht in der Akte und im Kalenderblick.
--
-- 4) deals.sortierung / projekte.sortierung
--    Reihenfolge innerhalb einer Kanban-Spalte. Kleinere Zahl = weiter oben.
--    NULL = noch nie von Hand sortiert, faellt ans Ende (nach Datum).
-- =====================================================================

alter table public.firmen add column if not exists dringlichkeit     text;
alter table public.firmen add column if not exists erstgespraech_am  date;
alter table public.firmen add column if not exists faellig_am        date;
alter table public.firmen add column if not exists naechster_termin  date;
alter table public.firmen add column if not exists naechste_aufgabe  text;

alter table public.deals    add column if not exists sortierung int;
alter table public.projekte add column if not exists sortierung int;
