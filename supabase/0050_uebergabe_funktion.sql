-- =====================================================================
-- Flowstate — Übergabe als eigene Operation (Migration 0050)
--
-- Fortsetzung von 0048. Dort wurde die WITH-CHECK-Pruefung gelockert, und die
-- Uebergabe der FIRMA funktionierte. Die Deals blieben trotzdem haengen, mit
-- derselben Meldung. Der Grund ist eine zweite, unsichtbare Pruefung:
--
--   Postgres erzwingt bei einem UPDATE zusaetzlich die LESE-Regel fuer die
--   neue Zeile. Man darf sich eine Zeile nicht selbst unsichtbar machen —
--   sonst verschwaende sie stumm aus der eigenen Sicht.
--
-- Gemessen am 06.08. an einem Testdeal:
--
--   besitzer auf Kollegen                          -> abgewiesen
--   besitzer auf Kollegen + gewonnen_durch auf mich -> geht
--
-- Bei einer Uebergabe ist "unsichtbar machen" aber genau der Zweck. Die Regel
-- ist hier also die falsche Regel — nicht zu streng eingestellt, sondern auf
-- die falsche Frage angewandt.
--
-- Darum bekommt die Uebergabe eine eigene Funktion. Sie laeuft mit den Rechten
-- des Eigentuemers (SECURITY DEFINER) und prueft die Berechtigung SELBST,
-- einmal und ausdruecklich: Wer die Firma betreut, darf sie weitergeben; die
-- Geschaeftsfuehrung darf es immer. Das ist ehrlicher als eine Regel, die
-- "gib nichts weg" heisst und die man umschreiben muesste, bis sie es nicht
-- mehr heisst.
--
-- Nebenbei behoben: Deals wurden ohne gewonnen_durch angelegt (leadakteAnlegen,
-- callErgebnis). 0047 hatte den Bestand aufgefuellt — alles danach Angelegte
-- stand wieder auf NULL. Ein Deal ohne Zurechnung gehoert niemandem, und wer
-- ihn geholt hat, verliert ihn beim ersten Wechsel aus den Augen.
-- =====================================================================

-- ------------------------------------------------- 1) Bestand auffuellen
-- Wer betreut, hat ihn bisher auch geholt — eine andere Angabe gibt es nicht.
-- Wiederholbar: fasst nur an, was leer ist.
update public.deals  set gewonnen_durch = besitzer
 where gewonnen_durch is null and besitzer is not null;
update public.firmen set gewonnen_durch = besitzer
 where gewonnen_durch is null and besitzer is not null;

-- ------------------------------------------------ 2) Die Uebergabe selbst
--
-- Gibt zurueck, was tatsaechlich mitgewandert ist — die Akte schreibt daraus
-- ihren Verlaufseintrag ("2 Abschlüsse, 1 Projekt mitgewandert"). Zahlen aus
-- der Operation selbst, nicht aus einer zweiten Abfrage hinterher: sonst
-- stimmen sie irgendwann nicht mehr ueberein.
create or replace function public.firma_uebergeben(p_firma bigint, p_neuer uuid)
returns table (deals integer, projekte integer, aufgaben integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_alt   uuid;
  v_deals integer := 0;
  v_proj  integer := 0;
  v_auf   integer := 0;
begin
  -- Wer ist der neue Verantwortliche? Muss es wirklich geben und aktiv sein.
  -- Ohne diese Pruefung koennte eine erfundene uuid eine Firma unerreichbar
  -- machen: sichtbar ist sie dann fuer niemanden mehr ausser der GF.
  if not exists (select 1 from public.profiles where id = p_neuer and aktiv) then
    raise exception 'Diese Person gibt es nicht oder sie ist nicht aktiv';
  end if;

  select besitzer into v_alt from public.firmen where id = p_firma;
  if not found then
    raise exception 'Firma % gibt es nicht', p_firma;
  end if;

  -- Die Berechtigung. Das ist die Stelle, die die Zeilenrechte ersetzt —
  -- darum steht sie hier und nicht im Programmcode: Eine Pruefung, die man
  -- vergessen kann, ist keine.
  if not (public.ist_admin() or v_alt = auth.uid()) then
    raise exception 'Nur wer die Firma betreut, darf sie übergeben';
  end if;

  if v_alt is not distinct from p_neuer then
    return query select 0, 0, 0;
    return;
  end if;

  update public.firmen set besitzer = p_neuer, letzte_aktivitaet = now()
   where id = p_firma;

  -- Offene wie abgeschlossene Deals wandern mit: Sichtbarkeit folgt der
  -- Betreuung. Die Zurechnung (gewonnen_durch) bleibt, wo sie ist — der
  -- Umsatz gehoert weiter dem, der den Kunden geholt hat (0047).
  with b as (
    update public.deals set besitzer = p_neuer
     where firma_id = p_firma and besitzer is distinct from p_neuer
     returning 1)
  select count(*)::integer into v_deals from b;

  with b as (
    update public.projekte set besitzer = p_neuer
     where firma_id = p_firma and besitzer is distinct from p_neuer
     returning 1)
  select count(*)::integer into v_proj from b;

  -- Nur OFFENE Aufgaben. Erledigte gehoeren zur Historie dessen, der sie
  -- gemacht hat — sie umzuhaengen waere eine Faelschung der Leistung.
  with b as (
    update public.aufgaben set besitzer = p_neuer
     where firma_id = p_firma and erledigt = false and besitzer is distinct from p_neuer
     returning 1)
  select count(*)::integer into v_auf from b;

  return query select v_deals, v_proj, v_auf;
end;
$$;

revoke all on function public.firma_uebergeben(bigint, uuid) from public;
grant execute on function public.firma_uebergeben(bigint, uuid) to authenticated;

comment on function public.firma_uebergeben is
  'Uebergibt eine Firma samt Deals, Projekten und offenen Aufgaben an eine '
  'andere Person. Laeuft mit erhoehten Rechten und prueft selbst, ob der '
  'Aufrufer die Firma betreut (oder GF ist). Grund: Die Zeilenrechte '
  'verbieten, eine Zeile fuer sich selbst unsichtbar zu machen — bei einer '
  'Uebergabe ist genau das der Zweck.';
