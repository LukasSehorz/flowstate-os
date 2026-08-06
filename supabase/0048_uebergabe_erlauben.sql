-- =====================================================================
-- Flowstate — Ein Mitarbeiter darf seinen Lead uebergeben (Migration 0048)
--
-- Der Fall vom 06.08.2026, 08:29 Uhr: Simon telefoniert die Fahrschule
-- Baptistella an, bucht ein Erstgespraech und traegt in der Akte ein, dass
-- Jannik das Gespraech fuehrt — er stellt "Verantwortlich" auf Jannik und
-- drueckt Speichern. Ergebnis:
--
--   {"ok":false,"fehler":"Da ist auf dem Server etwas schiefgegangen."}
--
-- Im Log: new row violates row-level security policy for table "deals".
-- Er hat es dreimal versucht, jedes Mal dasselbe; alles Eingetippte war weg.
-- Um 08:42 hat Jannik die Uebergabe selbst gemacht — als Admin geht sie.
--
-- Warum es scheiterte: Die UPDATE-Regeln pruefen den Zeilenbesitzer ZWEIMAL.
--
--   USING      — welche Zeilen darf ich anfassen?   (besitzer = ich)
--   WITH CHECK — wie darf die Zeile danach aussehen? (besitzer = ich)
--
-- Die zweite Pruefung macht eine Uebergabe unmoeglich: Sobald jemand anderes
-- eingetragen wird, ist die Zeile nicht mehr "meine" und die Aenderung wird
-- abgewiesen. Ein Mitarbeiter konnte also nur an sich selbst uebergeben.
--
-- Das ist genau der Ablauf, fuer den 0047 die zwei Felder eingefuehrt hat:
-- "Ioannis holt einen Lead herein, Jannik fuehrt das Verkaufsgespraech."
-- Geholt (gewonnen_durch) und betreut (besitzer) duerfen auseinanderfallen —
-- nur durfte es bisher niemand ausser der Geschaeftsfuehrung eintragen.
--
-- Ab jetzt gilt: WAS ich anfassen darf, entscheidet weiterhin USING — daran
-- aendert sich nichts, fremde Zeilen bleiben fremd. WORAUF ich es setzen darf,
-- ist offen, solange am Ende ein echter Mensch verantwortlich ist. Verschenken
-- kann man nur, was einem gehoert.
--
-- Die Bedingung "besitzer is not null" ist kein Beiwerk: Ohne sie koennte man
-- eine Zeile herrenlos machen, und herrenlose Zeilen sind laut firmen_lesen
-- fuer ALLE sichtbar. Ein Lead waere damit oeffentlich, ohne dass es jemand
-- merkt.
-- =====================================================================

-- ---------------------------------------------------------------- firmen
drop policy if exists firmen_aendern on public.firmen;
create policy firmen_aendern on public.firmen
  for update
  using       (ist_admin() or besitzer = auth.uid())
  with check  (ist_admin() or besitzer is not null);

-- ----------------------------------------------------------------- deals
drop policy if exists deals_aendern on public.deals;
create policy deals_aendern on public.deals
  for update
  using       (ist_admin() or besitzer = auth.uid())
  with check  (ist_admin() or besitzer is not null);

-- -------------------------------------------------------------- projekte
drop policy if exists projekte_aendern on public.projekte;
create policy projekte_aendern on public.projekte
  for update
  using       (ist_admin() or besitzer = auth.uid())
  with check  (ist_admin() or besitzer is not null);

-- -------------------------------------------------------------- aufgaben
-- Hier steht EINE Regel fuer alle Befehle (aufgaben_alle). Sie wird in die
-- einzelnen Befehle zerlegt, weil nur beim UPDATE die zweite Pruefung weicher
-- werden darf. Beim Anlegen und Loeschen bleibt alles, wie es war.
--
-- "besitzer is null" bleibt beim Lesen und Anlegen erlaubt: Aufgaben ohne
-- Besitzer gibt es im Bestand, und sie sollen sichtbar bleiben.
drop policy if exists aufgaben_alle on public.aufgaben;

drop policy if exists aufgaben_lesen on public.aufgaben;
create policy aufgaben_lesen on public.aufgaben
  for select using (ist_admin() or besitzer = auth.uid() or besitzer is null);

drop policy if exists aufgaben_anlegen on public.aufgaben;
create policy aufgaben_anlegen on public.aufgaben
  for insert with check (ist_admin() or besitzer = auth.uid() or besitzer is null);

drop policy if exists aufgaben_aendern on public.aufgaben;
create policy aufgaben_aendern on public.aufgaben
  for update
  using       (ist_admin() or besitzer = auth.uid() or besitzer is null)
  with check  (ist_admin() or besitzer is not null);

drop policy if exists aufgaben_loeschen on public.aufgaben;
create policy aufgaben_loeschen on public.aufgaben
  for delete using (ist_admin() or besitzer = auth.uid() or besitzer is null);
