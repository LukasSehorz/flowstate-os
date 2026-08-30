-- =====================================================================
-- Flowstate — Das Whiteboard (Migration 0056)
--
-- Warum (30.08.2026): Neben der To-Do-Liste (/todos, Tabelle "aufgaben")
-- kommt eine freie Flaeche: ein Whiteboard je Person, alle nebeneinander an
-- einer Wand (/whiteboard). Dort schreibt man mit Tastatur ODER freihaendig
-- mit dem Stift, hakt ab, streicht durch, wischt weg.
--
-- Das ist KEINE zweite Aufgabenverwaltung — bewusst eine EIGENE Tabelle:
-- Whiteboard-Elemente sind Striche, Textbloecke und Haftnotizen mit Position
-- und Geometrie, keine Aufgaben mit Frist und Wichtigkeit. Eine Zeile auf dem
-- Board wird NICHT automatisch zur Aufgabe in "aufgaben" (Bruecke steht im
-- Backlog). Die Regel aus todo-routes.js ("eine Tabelle, eine Wahrheit")
-- gilt dort fuer Aufgaben — hier geht es um Tinte und Zettel.
--
-- Geometrie liegt als JSON in einer text-Spalte. Das ist gewollt: In "inhalt"
-- wird nie relational gesucht oder gefiltert — es ist reine Anzeige-Geometrie
-- (Strichpunkte, Zeilen einer Notiz). Eine Spalte je Feld oder eine
-- Punkte-Tabelle wuerde nur Abfragen ermoeglichen, die niemand stellt.
--
-- Die id kommt vom CLIENT (crypto.randomUUID), nicht aus einer Sequenz:
-- So steht die id schon fest, waehrend der Strich noch gezeichnet wird —
-- Undo, Sync und optimistische Anzeige brauchen dann keinen Temp-id-Abgleich,
-- und "anlegen" ist mit "on conflict do nothing" gefahrlos wiederholbar
-- (Netzwakler beim Speichern fuehrt nicht zu Doppelten).
--
-- Geloescht wird weich (geloescht = Zeitstempel), nicht hart: Der 5-Sekunden-
-- Delta-Sync der anderen Browser muss vom Loeschen erfahren (Tombstone), und
-- "Tafel wischen" soll per Undo zurueckholbar sein. Alte Tombstones raeumt
-- der Server nach 30 Tagen endgueltig weg (Aufraeumjob in whiteboard-routes).
-- =====================================================================

create table if not exists public.whiteboard_elemente (
  id        uuid primary key default gen_random_uuid(),
  -- besitzer = wer das Element GESCHRIEBEN hat (der Autor).
  -- tafel    = auf WESSEN Board es steht.
  -- Meist dieselbe Person — auseinander gehen sie, wenn jemand einem anderen
  -- eine Aufgabe auf die Tafel schreibt ("Lukas gibt Jannik eine Aufgabe",
  -- Wunsch vom 31.08.2026). Die Oberflaeche zeigt dann "von Lukas" am Element.
  besitzer  uuid not null references public.profiles(id),
  tafel     uuid not null references public.profiles(id),
  art       text not null check (art in ('strich','text','notiz')),
  -- Bounding-Box in BOARD-Koordinaten (relativ zur linken oberen Ecke des
  -- Boards aus "tafel", nicht der Wand): So darf die Reihenfolge der Boards an
  -- der Wand spaeter wechseln (neuer Mitarbeiter), ohne dass ein Element
  -- umgerechnet werden muss. Auch Strich-Punkte in "inhalt" sind board-relativ.
  x         int not null default 0,
  y         int not null default 0,
  breite    int not null default 0,
  hoehe     int not null default 0,
  -- JSON je art:
  --   strich: {"punkte":[x1,y1,x2,y2,...], "farbe":"...", "dicke":n}  (Ints, flach)
  --   text:   {"zeilen":[{"t":"...","erledigt":false,"gestrichen":false},...],
  --            "liste":"keine|zahl|buchstabe|punkt|check", "farbe":"...", "groesse":n}
  --   notiz:  wie text, zusaetzlich "zettel":"gelb|rosa|mint|blau"
  inhalt    text not null,
  erstellt  timestamptz not null default now(),
  -- Auf Millisekunden gestutzt, damit der Wert verlustfrei als ISO-Text zum
  -- Browser und zurueck reist: JavaScript kennt keine Mikrosekunden, und die
  -- Versionspruefung beim Aendern vergleicht auf Gleichheit.
  geaendert timestamptz not null default date_trunc('milliseconds', now()),
  -- Zaehler fuer die Versionspruefung: "aendern" schreibt nur, wenn der Client
  -- die Version nennt, die er zuletzt gesehen hat (update ... where version = $n).
  -- Ein ganzzahliger Vergleich statt Zeitstempel-Gleichheit — nichts zu runden.
  version   int not null default 1,
  geloescht timestamptz
);

comment on table public.whiteboard_elemente is
  'Elemente der Whiteboard-Wand (/whiteboard): Striche, Textbloecke, Haftnotizen. '
  'Ein Board je Person; tafel = wessen Board, besitzer = wer es geschrieben hat. '
  'Weiches Loeschen ueber geloescht.';

create index if not exists whiteboard_elemente_tafel     on public.whiteboard_elemente (tafel);
create index if not exists whiteboard_elemente_geaendert on public.whiteboard_elemente (geaendert);

-- Jede Aenderung bumpt Version und Zeitstempel — AUCH weiches Loeschen und
-- Wiederherstellen. Nur so reisen Tombstones ueber den Delta-Cursor
-- (geaendert > seit) zu den anderen Browsern. Haende weg vom Gedanken, das in
-- jedem Update selbst zu setzen: Beim Sammel-Update von "Tafel wischen"
-- vergisst man es garantiert einmal.
create or replace function public.whiteboard_beruehrt()
returns trigger
language plpgsql
as $$
begin
  new.version   := old.version + 1;
  new.geaendert := date_trunc('milliseconds', now());
  return new;
end;
$$;

drop trigger if exists whiteboard_elemente_beruehrt on public.whiteboard_elemente;
create trigger whiteboard_elemente_beruehrt
  before update on public.whiteboard_elemente
  for each row execute function public.whiteboard_beruehrt();

-- ---------------------------------------------------------------------
-- Rechte: JEDER Angemeldete sieht ALLE Boards (ausdruecklich gewuenscht —
-- auch Mitarbeitende sehen die Boards der anderen, wie an einer echten
-- Buerowand). ANLEGEN darf jeder ueberall — nur ehrlich: besitzer muss die
-- eigene Person sein, die Tafel ist frei waehlbar ("Aufgabe geben").
--
-- AENDERN und LOESCHEN duerfen genau ZWEI Personen: der Autor (besitzer)
-- und die Person, auf deren Tafel es steht (tafel) — Jannik darf eine
-- Aufgabe abhaken, die Lukas ihm hingeschrieben hat, und seine Tafel auch
-- davon wischen. Mehr als diese zwei nie: So bleibt die Zahl moeglicher
-- gleichzeitiger Schreiber pro Element winzig, und den Rest faengt die
-- Versionspruefung beim Aendern (409 -> Stand nachladen).
-- ---------------------------------------------------------------------
alter table public.whiteboard_elemente enable row level security;

drop policy if exists whiteboard_lesen on public.whiteboard_elemente;
create policy whiteboard_lesen on public.whiteboard_elemente
  for select using (auth.uid() is not null);

drop policy if exists whiteboard_anlegen on public.whiteboard_elemente;
create policy whiteboard_anlegen on public.whiteboard_elemente
  for insert with check (besitzer = auth.uid());

-- WITH CHECK auch beim Aendern: sonst koennte ein Update ein Element einem
-- anderen Autor unterschieben. (Weder besitzer noch tafel werden von der
-- Anwendung je umgeschrieben — die Regel steht fuer den Fall, dass doch
-- einmal jemand am Server vorbei schreibt.)
drop policy if exists whiteboard_aendern on public.whiteboard_elemente;
create policy whiteboard_aendern on public.whiteboard_elemente
  for update using (besitzer = auth.uid() or tafel = auth.uid())
  with check (besitzer = auth.uid() or tafel = auth.uid());

-- Hartes Loeschen macht nur der Aufraeumjob (laeuft als Datenbank-Eigentuemer
-- an RLS vorbei). Aus der Oberflaeche wird immer weich geloescht (update).
drop policy if exists whiteboard_loeschen on public.whiteboard_elemente;
create policy whiteboard_loeschen on public.whiteboard_elemente
  for delete using (besitzer = auth.uid() or tafel = auth.uid());

grant select, insert, update, delete on public.whiteboard_elemente to authenticated;

-- ---------------------------------------------------------------------
-- Bereich freischalten: alle aktiven Konten bekommen "whiteboard" in ihre
-- Modul-Liste (0046). Fuer Admins ist die Liste bedeutungslos, es schadet
-- aber auch nicht. Wiederholbar: haengt nur an, wo es noch fehlt.
-- Neue Konten: scripts/nutzer-anlegen.js pflegt die Grundstock-Liste.
-- ---------------------------------------------------------------------
update public.profiles
   set module = array_append(module, 'whiteboard')
 where aktiv and not ('whiteboard' = any(module));
