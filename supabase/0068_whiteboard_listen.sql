-- =====================================================================
-- Flowstate — Zwei Uebersichts-Listen unter dem Whiteboard
-- (Migration 0068, eingespielt am 09.09.2026)
--
-- ACHTUNG, DIESE DATEI IST NACHTRAEGLICH REKONSTRUIERT (14.09.2026).
--
-- Das Migrationsbuch (schema_migrationen) fuehrt "0068_whiteboard_listen.sql"
-- seit dem 09.09.2026 als eingespielt, und die Tabelle steht in der
-- Datenbank — die DATEI fehlte aber im Repo: nicht im Ordner supabase/, nicht
-- in der Git-Historie, auf keinem Branch. Aufgefallen ist das am 14.09.2026,
-- als die naechste Migration ebenfalls die Nummer 0068 bekommen sollte; sie
-- heisst deshalb jetzt 0069_aufgabe_uhrzeit.sql.
--
-- Das ist genau die Luecke, gegen die lib/migrationen.js geschrieben wurde —
-- nur umgekehrt: nicht Code ohne Datenbank, sondern Datenbank ohne Code. Wer
-- die Datenbank neu aufsetzt (Nachbau, Drehkulisse, ein zweiter Mandant),
-- haette diese Tabelle sonst nie bekommen, und das Whiteboard waere dort ohne
-- erkennbaren Grund kaputt.
--
-- ABGELEITET AUS DEM LAUFENDEN SCHEMA, nicht aus dem urspruenglichen Text:
-- Spalten samt Vorgabewerten, Primaerschluessel, Check, Index, RLS und
-- Tabellen-Kommentar sind am 14.09.2026 aus information_schema, pg_indexes,
-- pg_policies und pg_constraint der Betriebsdatenbank abgelesen. Die
-- Begruendungen unten sind daher aus dem Aufbau geschlossen und nicht vom
-- urspruenglichen Verfasser; die Struktur selbst stimmt mit dem Betrieb
-- ueberein. Die Tabelle war dabei leer (0 Zeilen), es ging also keine
-- Nutzereingabe verloren.
--
-- WOFUER: Unter dem Whiteboard stehen zwei feste Listen, "kunden" und
-- "leads" — freie Textzeilen mit Firma, Aufgabe/Status und Preis, von Hand
-- sortierbar (position) und vom ganzen Team gemeinsam gepflegt. Anders als
-- die Aufgaben aus dem CRM gehoeren sie niemandem einzeln: Darum sieht und
-- aendert sie jeder Angemeldete, und es gibt keine Besitzer-Spalte.
--
-- Der Check haelt die zwei Listen fest: Ein Tippfehler im Listennamen wuerde
-- sonst eine dritte, unsichtbare Liste anlegen, deren Zeilen niemand mehr
-- findet. Der Index (liste, position) deckt die einzige Abfrage, die es gibt:
-- "alle Zeilen dieser Liste in ihrer Reihenfolge".
--
-- Wiederholbar: create table / create index / create policy jeweils mit
-- Vorpruefung. Ein erneuter Lauf gegen die Betriebsdatenbank aendert nichts.
-- =====================================================================

create table if not exists public.whiteboard_listenzeilen (
  id         uuid primary key default gen_random_uuid(),
  -- Welche der beiden Listen. Siehe Check unten.
  liste      text        not null,
  -- Die drei Textspalten der Zeile. Leer erlaubt, aber nie NULL: Eine halb
  -- ausgefuellte Zeile ist der Normalfall beim Tippen, und "" laesst sich
  -- anzeigen, ohne an jeder Stelle auf NULL zu pruefen.
  firma      text        not null default '',
  aufgabe    text        not null default '',
  preis      text        not null default '',
  -- Reihenfolge in der Liste, von Hand gezogen. Kleinere Zahl = weiter oben.
  position   integer     not null default 0,
  erstellt   timestamptz not null default now(),
  -- Auf Millisekunden gekuerzt: Der Browser vergleicht diesen Stempel, um zu
  -- erkennen, ob eine Zeile fremd geaendert wurde. Mikrosekunden ueberleben
  -- den Weg durch JSON und JavaScript-Datumswerte nicht unveraendert.
  geaendert  timestamptz not null default date_trunc('milliseconds', now())
);

comment on table public.whiteboard_listenzeilen is
  'Zwei feste Uebersichts-Listen unter dem Whiteboard: Kunden und Leads. '
  'Freie Textzeilen (Firma, Aufgabe/Status, Preis), von Hand sortierbar, '
  'vom ganzen Team gemeinsam gepflegt.';

-- Genau zwei Listen — ein verschriebener Name legt sonst eine dritte an,
-- die in der Oberflaeche nirgends auftaucht.
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.whiteboard_listenzeilen'::regclass
                    and conname  = 'whiteboard_listenzeilen_liste_check') then
    alter table public.whiteboard_listenzeilen
      add constraint whiteboard_listenzeilen_liste_check
      check (liste in ('kunden', 'leads'));
  end if;
end $$;

-- Die eine Abfrage, die es gibt: eine Liste in ihrer Reihenfolge.
create index if not exists whiteboard_listenzeilen_liste_position
  on public.whiteboard_listenzeilen (liste, "position");

grant select, insert, update, delete on public.whiteboard_listenzeilen to authenticated;
grant select, insert, update, delete on public.whiteboard_listenzeilen to service_role;

alter table public.whiteboard_listenzeilen enable row level security;

-- Gemeinsame Listen: Wer angemeldet ist, sieht und pflegt sie. Absichtlich
-- keine Besitzerpruefung wie bei firmen (0002) oder aufgaben (0058) — diese
-- Zeilen gehoeren dem Team, nicht einer Person.
drop policy if exists whiteboard_liste_lesen on public.whiteboard_listenzeilen;
create policy whiteboard_liste_lesen on public.whiteboard_listenzeilen
  for select using (auth.uid() is not null);

drop policy if exists whiteboard_liste_schreiben on public.whiteboard_listenzeilen;
create policy whiteboard_liste_schreiben on public.whiteboard_listenzeilen
  for all using (auth.uid() is not null) with check (auth.uid() is not null);
