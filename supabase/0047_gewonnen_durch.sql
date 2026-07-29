-- =====================================================================
-- Flowstate — Wer hat den Kunden GEHOLT, wer BETREUT ihn (Migration 0047)
--
-- Warum (29.07.2026): Bisher gab es nur ein Feld — besitzer. Das beantwortete
-- zwei verschiedene Fragen gleichzeitig und damit keine davon richtig:
--
--   "Wer betreut diesen Kunden?"        -> steuert, wer ihn im CRM sieht
--   "Wem ist der Umsatz zuzurechnen?"   -> steuert die Leistung je Person
--
-- Der Fall, an dem das auffliegt: Ioannis holt einen Lead herein, Jannik führt
-- das Verkaufsgespräch und macht den Abschluss. Danach betreut Jannik den
-- Kunden — aber geholt hat ihn Ioannis, und der Umsatz gehört in seine
-- Leistung. Mit einem Feld muss man sich für eine der beiden Wahrheiten
-- entscheiden; welche man auch wählt, die andere Zahl wird falsch.
--
-- Ab jetzt:
--   besitzer        = verantwortlich. Wer den Kunden betreut, sieht ihn im CRM,
--                     und die Karte auf dem Brett trägt seinen Namen.
--   gewonnen_durch  = wer ihn geholt hat. Danach wird der Umsatz zugerechnet.
--   quelle          = worüber (Cold Calling, Netzwerk, Empfehlung …) —
--                     die Spalte gibt es schon, sie bekommt nur ihren Platz
--                     neben der Person: "Gewonnen durch Jannik über Cold Calling".
--
-- Beide dürfen dieselbe Person sein — das ist der Normalfall und die Vorbelegung.
-- =====================================================================

alter table public.firmen add column if not exists gewonnen_durch uuid references public.profiles(id);
alter table public.deals  add column if not exists gewonnen_durch uuid references public.profiles(id);

comment on column public.firmen.gewonnen_durch is
  'Wer diesen Kunden/Lead geholt hat. Grundlage der Umsatz-Zurechnung je Person. '
  'besitzer ist etwas anderes: wer ihn betreut und ihn deshalb im CRM sieht.';

create index if not exists firmen_gewonnen_idx on public.firmen (gewonnen_durch);
create index if not exists deals_gewonnen_idx  on public.deals  (gewonnen_durch);

-- Bestand: Wer betreut, hat ihn bisher auch geholt — eine andere Angabe gibt es
-- nicht, und die Zahlen bleiben so unverändert. Wo es abweicht, wird es von
-- Hand nachgezogen.
update public.firmen set gewonnen_durch = besitzer where gewonnen_durch is null and besitzer is not null;
update public.deals   set gewonnen_durch = besitzer where gewonnen_durch is null and besitzer is not null;

-- ---------------------------------------------------------------- Zeilenrechte
--
-- Wer einen Kunden GEHOLT hat, muss ihn auch sehen dürfen — sonst verschwindet
-- er aus seinem CRM, sobald jemand anderes die Betreuung übernimmt, und seine
-- eigene Umsatzzahl liesse sich nicht nachvollziehen.
drop policy if exists firmen_lesen on public.firmen;
create policy firmen_lesen on public.firmen
  for select using (
    ist_admin() or besitzer = auth.uid() or gewonnen_durch = auth.uid() or besitzer is null
  );

drop policy if exists deals_lesen on public.deals;
create policy deals_lesen on public.deals
  for select using (
    ist_admin() or besitzer = auth.uid() or gewonnen_durch = auth.uid() or besitzer is null
  );

-- Ändern darf weiterhin nur, wer betreut (oder die Geschäftsführung). Geholt zu
-- haben gibt Einsicht, nicht Schreibrecht — sonst schrieben zwei Leute in
-- dieselbe Akte, ohne voneinander zu wissen.
