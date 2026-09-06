-- =====================================================================
-- Flowstate — Rechnungen und Angebote im Gespräch (Migration 0063)
--
-- Warum (Lukas, 05.09.2026): "Bei Rechnungen und Angeboten soll man das nur
-- per Chat erstellen können. Ich sage 'Kunde XYZ braucht eine Rechnung für
-- eine Website in Höhe von 750 €, erstelle das im bekannten Format', und dann
-- wird die Rechnung erstellt und im System abgelegt. Wenn ich später etwas an
-- der Rechnung ändern will, soll die bestehende Rechnung genommen, angepasst
-- und wieder abgelegt werden."
--
-- 0062 kann EINEN Satz in EINEN Entwurf verwandeln. Was fehlte, ist der Faden:
-- "Mach 900 daraus", "Setz das Datum auf den 1.", "Schreib noch eine Position
-- Hosting 120 € dazu". Dafuer muss irgendwo stehen, worueber gerade geredet
-- wird — sonst legt der zweite Satz einen zweiten Beleg an, und am Monatsende
-- liegen vier Entwuerfe derselben Rechnung im System.
--
-- EIN GESPRAECH HAENGT AN EINEM BELEG (der Kern, an dem alles haengt)
--
--   beleg_chat.rechnung_id ist der Faden. Solange er NULL ist, redet man ueber
--   nichts Bestimmtes (die erste Aeusserung, oder eine Rueckfrage "welchen
--   Anderka meinst du?"). Sobald ein Beleg entsteht, wird er hier eingetragen
--   und aendert sich nicht mehr: Jede weitere Aeusserung aendert GENAU DIESEN
--   Beleg. Deshalb ist rechnung_id nullable — ein Gespraech ohne Beleg ist ein
--   gueltiger Zustand, kein halber Datensatz.
--
--   Der eindeutige Index darauf ist die Regel in der Datenbank, nicht nur im
--   Code: Zu einem Beleg gibt es hoechstens EIN Gespraech. Kommt jemand ueber
--   "Im Chat ändern" von der Vorgangsseite, findet er den bestehenden Faden
--   und faengt nicht bei null an. Als partieller Index (where rechnung_id is
--   not null), weil beliebig viele Gespraeche noch ohne Beleg laufen duerfen.
--
--   on delete cascade: Wird der Entwurf geloescht, ist auch das Gespruech
--   darueber gegenstandslos. Ein Faden, der auf nichts zeigt, waere im
--   Verlauf nur Verwirrung.
--
-- NACHRICHTEN ALS JSONB, NICHT ALS TABELLE
--
--   Ein Verlauf wird immer ganz gelesen (die letzten 20 Zeilen gehen an das
--   Modell) und immer nur hinten angehaengt. Eine eigene Zeilentabelle
--   braeuchte dafuer einen Join und eine Sortierung und gewaenne nichts:
--   Niemand sucht ueber Chatnachrichten hinweg.
--
--   Form: [{rolle, text, zeit, tat?}]
--     rolle  "nutzer" | "assistent" | "system"
--     text   was gesagt wurde (der Code kuerzt auf 4000 Zeichen)
--     zeit   ISO-Zeitstempel
--     tat    optional, was dabei passiert ist:
--            {art: "anlegen"|"aendern"|"art-wechsel"|"abgelehnt", felder: […]}
--            Die Oberflaeche setzt daraus die kleine Zeile unter der Blase
--            ("Beleg angelegt · Betrag geändert"). Ohne sie waere im Verlauf
--            nicht mehr zu sehen, welcher Satz welche Zahl bewegt hat.
--
-- RECHTE: nur Geschaeftsfuehrung (ist_admin), wie bei allem in der
-- Buchhaltung. Anders als bei rechnungen selbst, wo Louis den Zahlstand seiner
-- Kunden sehen darf: In einem Gespraech ueber eine Rechnung stehen Preise,
-- Nachlaesse und Zwischenstaende, die in keiner Akte etwas zu suchen haben.
-- =====================================================================

create table if not exists public.beleg_chat (
  id           bigserial primary key,
  rechnung_id  bigint references public.rechnungen(id) on delete cascade,
  nutzer       uuid references public.profiles(id),
  nachrichten  jsonb not null default '[]'::jsonb,
  erstellt     timestamptz not null default now(),
  geaendert    timestamptz not null default now()
);

create index if not exists beleg_chat_rechnung_idx on public.beleg_chat (rechnung_id);
-- Fuer "das zuletzt gefuehrte Gespraech dieses Nutzers" auf der leeren Seite.
create index if not exists beleg_chat_nutzer_idx on public.beleg_chat (nutzer, geaendert desc);
-- Ein Gespraech je Beleg — siehe oben. Partiell, damit mehrere Gespraeche ohne
-- Beleg nebeneinander laufen duerfen.
create unique index if not exists beleg_chat_rechnung_einmalig
  on public.beleg_chat (rechnung_id) where rechnung_id is not null;

comment on table public.beleg_chat is
  'Der Gespraechsfaden zu genau einem Beleg (05.09.2026). rechnung_id = worueber geredet wird; solange NULL, gibt es den Beleg noch nicht. Jede weitere Aeusserung aendert diesen einen Beleg, statt einen zweiten anzulegen.';
comment on column public.beleg_chat.nachrichten is
  'Verlauf als [{rolle:"nutzer"|"assistent"|"system", text, zeit, tat?:{art, felder}}]. Wird nur hinten angehaengt; die Oberflaeche zeigt alles, an das Modell gehen die letzten 20.';
comment on column public.beleg_chat.rechnung_id is
  'Der Beleg, um den es geht. NULL = das Gespraech hat noch keinen (erste Aeusserung oder Rueckfrage). Eindeutig: zu einem Beleg gibt es hoechstens ein Gespraech.';

-- ---------------------------------------------------------------------
-- Rechte
-- ---------------------------------------------------------------------
alter table public.beleg_chat enable row level security;

drop policy if exists beleg_chat_lesen on public.beleg_chat;
create policy beleg_chat_lesen on public.beleg_chat
  for select using (public.ist_admin());

drop policy if exists beleg_chat_anlegen on public.beleg_chat;
create policy beleg_chat_anlegen on public.beleg_chat
  for insert with check (public.ist_admin());

drop policy if exists beleg_chat_aendern on public.beleg_chat;
create policy beleg_chat_aendern on public.beleg_chat
  for update using (public.ist_admin()) with check (public.ist_admin());

drop policy if exists beleg_chat_loeschen on public.beleg_chat;
create policy beleg_chat_loeschen on public.beleg_chat
  for delete using (public.ist_admin());
