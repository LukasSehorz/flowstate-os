-- =====================================================================
-- Flowstate — Schutzregel nachgezogen (Migration 0025)
--
-- Beim Durchtesten von 0024 sind drei Luecken aufgefallen. Alle drei haben
-- dieselbe Ursache: die Regeln haben nur geprueft, ob sich ein Wert AENDERT,
-- nicht ob er ueberhaupt gesetzt ist.
--
--   1) Datei leeren / austauschen ging bei einer Zeile durch, deren daten
--      bereits NULL war (Altbestand aus der Lexware-Zeit, dort wurde die Datei
--      nach der Uebertragung geleert). Der Schutz "alte Datei ist da" traf nicht
--      zu, also griff er nicht.
--
--   2) Dasselbe bei der Pruefsumme: war sie NULL, liess sie sich frei setzen.
--
--   3) Und die eigentliche Schwaeche dahinter: eine Datei OHNE Pruefsumme war
--      erlaubt. Damit waere der ganze Nachweis wertlos — man haette eine Datei
--      einsetzen und die Pruefsumme einfach weglassen koennen.
--
-- Die neue Fassung dreht die Logik um: nicht "was war da" entscheidet, sondern
-- "was ist erlaubt". Erlaubt ist genau ein Uebergang, naemlich eine fehlende
-- Datei EINMAL nachzureichen — und dann nur zusammen mit ihrer Pruefsumme.
-- Alles andere an Datei und Pruefsumme ist gesperrt.
--
-- Warum das Nachreichen ueberhaupt offen bleibt: die zwei Altbelege haben ihre
-- Datei nur in Lexware. Wer sie dort herunterlaedt, soll sie hier nachlegen
-- koennen, ohne dass eine Luecke in der Nummerierung entsteht.
-- =====================================================================

create or replace function public.belege_schutz() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    raise exception
      'Belege dürfen nicht gelöscht werden (Aufbewahrungspflicht). Setze status = ''verworfen'' mit Grund.';
  end if;

  -- --- Datei -------------------------------------------------------------
  -- Der einzige erlaubte Uebergang ist NULL -> Datei (Nachreichen). Eine
  -- vorhandene Datei ist unantastbar, und geleert wird nie.
  if old.daten is not null and new.daten is null then
    raise exception 'Eine vorhandene Belegdatei darf nicht geleert werden (Aufbewahrungspflicht).';
  end if;
  if old.daten is not null and new.daten is distinct from old.daten then
    raise exception 'Eine vorhandene Belegdatei darf nicht ersetzt werden (Aufbewahrungspflicht).';
  end if;

  -- --- Pruefsumme --------------------------------------------------------
  -- Eine gesetzte Pruefsumme ist unantastbar.
  if old.pruefsumme is not null and new.pruefsumme is distinct from old.pruefsumme then
    raise exception 'Die Prüfsumme darf nicht verändert werden (Aufbewahrungspflicht).';
  end if;

  -- Eine Datei ohne Pruefsumme gibt es nicht. Das ist der Kern des Nachweises:
  -- ohne diese Regel koennte man eine Datei einsetzen und den Nachweis, dass sie
  -- unveraendert ist, einfach weglassen.
  if new.daten is not null and new.pruefsumme is null then
    raise exception 'Zu einer Belegdatei gehört zwingend eine Prüfsumme (Aufbewahrungspflicht).';
  end if;

  -- Und umgekehrt: eine Pruefsumme ohne Datei waere eine Behauptung ohne
  -- Gegenstand. Sie darf nur zusammen mit der Datei entstehen.
  if old.pruefsumme is null and new.pruefsumme is not null and new.daten is null then
    raise exception 'Eine Prüfsumme ohne Belegdatei ist nicht zulässig (Aufbewahrungspflicht).';
  end if;

  -- --- Herkunft und Nummerierung ----------------------------------------
  if old.laufnummer is not null and new.laufnummer is distinct from old.laufnummer then
    raise exception 'Die Laufnummer darf nicht verändert werden (Aufbewahrungspflicht).';
  end if;
  if new.erstellt is distinct from old.erstellt then
    raise exception 'Der Eingangszeitpunkt darf nicht verändert werden (Aufbewahrungspflicht).';
  end if;
  if old.dateiname is not null and new.dateiname is distinct from old.dateiname then
    raise exception 'Der Dateiname darf nicht verändert werden (Aufbewahrungspflicht).';
  end if;

  -- Einmal verworfen bleibt verworfen. Sonst waere der Vermerk wertlos.
  if old.verworfen_am is not null and new.verworfen_am is null then
    raise exception 'Ein verworfener Beleg kann nicht zurückgeholt werden. Lade ihn neu hoch.';
  end if;

  return new;
end $$;

-- Sicherheitsnetz fuer den Altbestand: eine Datei, die schon liegt, aber keine
-- Pruefsumme hat, waere ab jetzt unveraenderbar OHNE Nachweis — der schlechteste
-- von beiden Zustaenden. Es gibt aktuell keine solche Zeile; falls doch eine
-- auftaucht, faellt sie hier auf statt still liegen zu bleiben.
do $$
declare offen int;
begin
  select count(*) into offen from public.belege
   where daten is not null and pruefsumme is null;
  if offen > 0 then
    raise notice 'Achtung: % Beleg(e) haben eine Datei ohne Prüfsumme. Bitte nachrechnen.', offen;
  end if;
end $$;
