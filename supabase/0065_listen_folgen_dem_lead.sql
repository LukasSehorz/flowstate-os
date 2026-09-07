-- =====================================================================
-- Flowstate — Eine weitergegebene Liste bleibt filterbar (Migration 0065)
--
-- Gemeldet am 07.09.2026: Jannik importiert die Liste "Google Maps Strategie
-- | MÜ; LA; REG Vororte" (299 Leads). Lukas weist die Leads Ioannis zu.
-- Danach ist die Liste bei Ioannis nicht mehr filterbar — ihre 299 Leads
-- liegen ununterscheidbar zwischen rund 600 aelteren Werbescreen-Leads.
--
-- Zwei Ursachen, eine in der Anwendung, eine hier:
--
--   1) lib/crm.js (leadListen) baute das Auswahlfeld aus call_listen.besitzer,
--      also aus dem IMPORTEUR, waehrend die Anrufliste darunter nach
--      firmen.besitzer eingegrenzt ist. Das ist im Code behoben.
--
--   2) Diese Migration: Selbst mit dem richtigen Auswahlfeld saehe Ioannis
--      nichts. Die Rechteregeln aus 0002 binden call_listen und
--      call_listen_eintraege ausschliesslich an call_listen.besitzer — an den
--      Importeur. Fuer Ioannis ist die Liste damit nicht vorhanden: Das
--      Auswahlfeld bleibt leer, und in der Anrufliste steht in der Spalte
--      "Liste" bei seinen eigenen Leads nichts. Nachgemessen: als Admin
--      liefert firmenListe fuer alle sechs Testleads den Listennamen, als
--      Ioannis selbst bei denselben Zeilen NULL.
--
-- Der Zuschnitt: Wer einen Lead besitzt, darf sehen, AUS WELCHER Liste dieser
-- Lead stammt. Mehr nicht — Anlegen, Umbenennen und Loeschen einer Liste
-- bleiben beim Importeur und bei der Geschaeftsfuehrung. Die Regeln aus 0002
-- bleiben deshalb unangetastet; hier kommen nur zusaetzliche LESE-Regeln
-- dazu. Postgres verknuepft mehrere zulassende Regeln derselben Tabelle mit
-- ODER, es wird also nichts enger.
--
-- Wiederholbar: drop policy if exists / create or replace.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Hilfsfunktion — gegen Rekursion
-- ---------------------------------------------------------------------
-- Warum nicht einfach ein exists() in der Regel selbst? Die Regel auf
-- call_listen muesste dafuer call_listen_eintraege lesen, und deren Regel aus
-- 0002 liest call_listen. Postgres bricht das mit "infinite recursion detected
-- in policy for relation" ab. security definer laeuft als Eigentuemer der
-- Tabellen und umgeht die Regeln im Inneren — dasselbe Muster wie ist_admin()
-- aus 0002.
create or replace function public.liste_hat_meinen_lead(p_liste bigint)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.call_listen_eintraege e
      join public.firmen f on f.id = e.firma_id
     where e.liste_id = p_liste
       and f.besitzer = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------
-- 2) call_listen: sichtbar, wenn einer meiner Leads darin steht
-- ---------------------------------------------------------------------
drop policy if exists listen_lesen_ueber_leads on public.call_listen;
create policy listen_lesen_ueber_leads on public.call_listen
  for select using (public.liste_hat_meinen_lead(id));

-- ---------------------------------------------------------------------
-- 3) call_listen_eintraege: die Zuordnung meines eigenen Leads
-- ---------------------------------------------------------------------
-- Hier braucht es keine Hilfsfunktion: Die Regel liest nur firmen, und die
-- Regeln auf firmen lesen nichts, was zurueck auf call_listen zeigt.
-- Bewusst ueber firma_id und nicht ueber liste_id: Ein Mitarbeiter soll die
-- Herkunft SEINER Leads sehen, nicht die komplette Mitgliederliste einer
-- Liste, in der zufaellig auch einer von ihm steht.
drop policy if exists listen_eintraege_lesen_ueber_leads on public.call_listen_eintraege;
create policy listen_eintraege_lesen_ueber_leads on public.call_listen_eintraege
  for select using (
    exists (select 1 from public.firmen f
             where f.id = call_listen_eintraege.firma_id
               and f.besitzer = auth.uid())
  );

-- ---------------------------------------------------------------------
-- 4) Index fuer den Weg Liste -> Lead-Besitzer
-- ---------------------------------------------------------------------
-- Das Auswahlfeld fragt jetzt "welche Listen enthalten Leads von Person X".
-- 0053 hat den Weg Lead -> Liste indiziert; dieser deckt die Gegenrichtung
-- zusammen mit idx_firmen_besitzer aus 0001 ab.
create index if not exists idx_listen_eintraege_liste
  on public.call_listen_eintraege(liste_id);
