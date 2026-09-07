-- =====================================================================
-- Flowstate — Woher eine Aufgabe kommt: aufgaben.anlass (Migration 0066,
-- 07.09.2026)
--
-- Wunsch von Lukas: "Wenn man hier eins von beiden auswählt [Erstgespräch
-- gebucht / Follow-up — Interesse, kein Termin], soll das auch gleich im
-- Whiteboard auftauchen. Also einfach Datum + kurz Stichpunkt, was genau zu
-- tun ist."
--
-- Der Weg dahin steht schon: lib/crm.js legt eine Aufgabe an, und
-- lib/aufgaben-tafel.js (0058) haengt sie als Zeile "<Firma>: <Titel>" mit
-- Link in die Akte an den Kunden-Block der verantwortlichen Person.
--
-- Was fehlte, ist die Antwort auf "gibt es das schon?". Ein Lead wird beim
-- Nacharbeiten oft zweimal mit DEMSELBEN Ergebnis gespeichert — man
-- korrigiert die Uhrzeit, traegt die Notiz nach, verklickt sich und waehlt
-- neu. Ohne Kennzeichen entstuenden dabei zwei, drei, vier Zeilen fuer
-- dieselbe Sache, und die Tafel wird zu dem Zettelhaufen, den sie ersetzen
-- soll.
--
--   anlass  Warum es diese Aufgabe gibt, als kurzer Schluessel:
--           'anruf:gebucht', 'anruf:follow-up'. Leer bei allem, was von Hand
--           angelegt wird — dort will man mehrere Aufgaben zum selben Kunden.
--
-- Warum ein eigenes Feld und NICHT ein Vergleich der Titel?
--   1. Der Titel traegt genau die Angabe, die sich beim zweiten Anruf aendert
--      ("Erstgespräch am 12.09. um 10:00" -> "… um 14:00"). Ein Vergleich
--      ueber den Titel faende die vorhandene Aufgabe also ausgerechnet dann
--      NICHT, wenn es darauf ankommt — und legte eine zweite an.
--   2. Umgekehrt trifft ein unscharfer Vergleich ("faengt mit 'Erstgespräch'
--      an") auch die Aufgabe, die jemand von Hand geschrieben hat, und
--      ueberschreibt ihm den Text.
--   3. Der Titel ist Anzeigetext. Wer ihn morgen schoener formuliert, haette
--      stillschweigend die Dublettenerkennung geaendert — ein Fehler, den
--      niemand beim Lesen des Diffs sieht.
-- Der Anlass dagegen ist eine Kennung: Er sagt, WOFUER die Aufgabe steht,
-- und aendert sich nie, waehrend Titel und Datum sich frei bewegen duerfen.
-- Gesucht wird immer als Dreiklang firma_id + anlass + erledigt = false:
-- abgehakt heisst erledigt, und ein neuer Anruf darf dann eine neue Aufgabe
-- ergeben.
--
-- Wiederholbar: add column if not exists, create index if not exists,
-- create or replace function.
-- =====================================================================

alter table public.aufgaben add column if not exists anlass text;

comment on column public.aufgaben.anlass is
  'Warum es die Aufgabe gibt (z. B. anruf:gebucht, anruf:follow-up). Leer bei von Hand angelegten. Erkennt Dubletten zusammen mit firma_id, siehe 0066.';

-- Der Index deckt genau die eine Frage von anrufSpeichern ab: "gibt es zu
-- DIESER Firma schon eine OFFENE Aufgabe mit DIESEM Anlass?". Teilindex,
-- weil die ueberwaeltigende Mehrheit der Zeilen keinen Anlass hat (alles von
-- Hand Angelegte) und erledigte nie gesucht werden — er bleibt damit klein.
create index if not exists idx_aufgaben_anlass
  on public.aufgaben(firma_id, anlass)
  where anlass is not null and erledigt = false;

-- ---------------------------------------------------------------- Text Liste -> Tafel
-- Wird eine vorhandene offene Aufgabe aktualisiert (zweiter Anruf, neue
-- Uhrzeit), muss die Zeile auf dem Whiteboard mitziehen — sonst stuende dort
-- weiter der alte Termin, und die Tafel loege.
--
-- Neu aufs Brett schreiben geht dafuer NICHT: aufgabeAufTafel() haengt immer
-- an, es gaebe also doch zwei Zeilen. Also dieselbe Loesung wie beim Haken in
-- 0058 — eine Funktion, die GENAU die eine Zeile aendert, die diese Aufgabe
-- traegt, und sonst nichts.
--
-- Wie 0058 am RLS von whiteboard_elemente vorbei (security definer): Die
-- Zeile kann inzwischen in einem Block liegen, der dem Anrufer nicht gehoert,
-- weil der Verantwortliche sie in seinen eigenen Block gezogen hat. Die
-- Funktion prueft selbst, dass der Aufrufer die Aufgabe angelegt hat oder
-- erledigen soll, und ruehrt nur das an der Aufgabe vermerkte Element an,
-- nur Zeilen mit genau diesem Bezug, nur deren Text. Der Trigger
-- whiteboard_elemente_beruehrt erhoeht dabei Version und Zeitstempel, damit
-- offene Browser die Aenderung ueber den Delta-Abgleich bekommen.
--
-- Rueckgabe wie in 0058: ok, unveraendert, zeile, geloescht, weg,
-- kein-bezug, recht, aufgabe.
create or replace function public.aufgabe_text_auf_tafel(p_aufgabe bigint, p_text text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  a record;
  e record;
  alt jsonb;
  neu jsonb;
  treffer int;
  txt text;
begin
  select id, besitzer, verantwortlich, tafel_element into a from public.aufgaben where id = p_aufgabe;
  if not found then return 'aufgabe'; end if;
  if auth.uid() is null
     or (a.besitzer is distinct from auth.uid() and a.verantwortlich is distinct from auth.uid()) then
    return 'recht';
  end if;
  if a.tafel_element is null then return 'kein-bezug'; end if;

  -- 400 = GRENZEN.zeichenJeZeile in whiteboard-routes.js. Laenger nimmt die
  -- Tafel keine Zeile an; hier gekuerzt statt drueben abgeschnitten.
  txt := left(coalesce(p_text, ''), 400);

  select id, inhalt, geloescht into e from public.whiteboard_elemente where id = a.tafel_element for update;
  if not found then return 'weg'; end if;
  if e.geloescht is not null then return 'geloescht'; end if;

  begin
    alt := e.inhalt::jsonb;
  exception when others then
    return 'zeile';   -- kaputtes JSON: die Wand ueberspringt das Element ohnehin
  end;
  if jsonb_typeof(alt->'zeilen') is distinct from 'array' then return 'zeile'; end if;

  select count(*) into treffer
    from jsonb_array_elements(alt->'zeilen') z
   where (z->>'aufgabe') ~ '^[0-9]+$' and (z->>'aufgabe')::bigint = p_aufgabe;
  if treffer = 0 then return 'zeile'; end if;

  select jsonb_set(alt, '{zeilen}', coalesce(jsonb_agg(
           case when (z->>'aufgabe') ~ '^[0-9]+$' and (z->>'aufgabe')::bigint = p_aufgabe
                then jsonb_set(z, '{t}', to_jsonb(txt))
                else z end
           order by ord), '[]'::jsonb))
    into neu
    from jsonb_array_elements(alt->'zeilen') with ordinality as t(z, ord);

  if neu = alt then return 'unveraendert'; end if;
  update public.whiteboard_elemente set inhalt = neu::text where id = e.id;
  return 'ok';
end;
$$;

revoke all on function public.aufgabe_text_auf_tafel(bigint, text) from public;
grant execute on function public.aufgabe_text_auf_tafel(bigint, text) to authenticated, service_role;
