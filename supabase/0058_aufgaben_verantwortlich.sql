-- =====================================================================
-- Flowstate — Aufgaben mit Verantwortlichem, Bruecke zum Whiteboard
-- (Migration 0058, 05.09.2026)
--
-- Wunsch von Lukas: "Wenn man To-Dos eintraegt, innerhalb des CRMs bei den
-- Kunden — beim Anlegen oder spaeter in der Akte — soll es automatisch aufs
-- Whiteboard uebertragen werden, automatisch in die Kategorie Kunden. Man
-- muss noch zuweisen, welche Person verantwortlich ist, weil sich danach
-- entscheidet, in welches Whiteboard es reingeht."
--
-- Bis heute kannte eine Aufgabe genau EINE Person: besitzer — Autor,
-- Eigentuemer und Ausfuehrender in einem. Jemandem eine Aufgabe zu geben
-- ging nur ueber das Whiteboard (Zeile auf fremde Tafel), und die Zeile dort
-- wusste nichts von der Aufgabenliste (0056: "Bruecke steht im Backlog").
--
-- Ab jetzt:
--   verantwortlich  wer die Aufgabe ERLEDIGT (null = der Besitzer selbst).
--                   Entscheidet, auf wessen Whiteboard die Aufgabe landet.
--                   besitzer bleibt der Anleger — wie beim Whiteboard-Element
--                   (besitzer = Autor, tafel = Empfaenger). So sieht Louis
--                   "von Lukas" und Lukas "fuer Louis".
--   tafel_element   id des Whiteboard-Elements (whiteboard_elemente.id), in
--                   dem die Zeile dieser Aufgabe steht. Kein Fremdschluessel:
--                   das Element darf weich geloescht und nach 30 Tagen hart
--                   entfernt werden, ohne dass die Aufgabe daran haengt — die
--                   Bruecke (lib/aufgaben-tafel.js) merkt beim naechsten
--                   Abgleich, dass es fehlt, und setzt das Feld auf null.
--   tafel_gesetzt   wann die Zeile aufs Whiteboard kam (Nachvollziehbarkeit).
--
-- "Eigene Aufgaben" heisst ab jetzt ueberall: besitzer = ich ODER
-- verantwortlich = ich. Die RLS-Regeln bekommen dieselbe Erweiterung, sonst
-- saehe Louis die Aufgabe, die Lukas ihm gegeben hat, gar nicht — und
-- koennte sie erst recht nicht abhaken. aufgaben_anlegen bleibt unveraendert:
-- angelegt wird immer als besitzer = Anleger.
-- =====================================================================

alter table public.aufgaben add column if not exists verantwortlich uuid references public.profiles(id);
alter table public.aufgaben add column if not exists tafel_element  uuid;
alter table public.aufgaben add column if not exists tafel_gesetzt  timestamptz;

comment on column public.aufgaben.verantwortlich is
  'Wer die Aufgabe erledigt (null = besitzer). Bestimmt die Whiteboard-Tafel.';
comment on column public.aufgaben.tafel_element is
  'whiteboard_elemente.id des Blocks, in dem die Zeile dieser Aufgabe steht (ohne FK, siehe 0058).';
comment on column public.aufgaben.tafel_gesetzt is
  'Wann die Aufgabe aufs Whiteboard geschrieben wurde.';

create index if not exists idx_aufgaben_verantwortlich on public.aufgaben(verantwortlich);

-- ---------------------------------------------------------------- RLS
-- Wiederholbar: drop + create, wie in 0048. Die Zerlegung in vier Regeln
-- bleibt, nur der Verantwortliche kommt bei lesen/aendern/loeschen dazu.
-- "besitzer is null" bleibt erlaubt — Altbestand ohne Besitzer soll
-- sichtbar bleiben (Begruendung in 0048).
drop policy if exists aufgaben_lesen on public.aufgaben;
create policy aufgaben_lesen on public.aufgaben
  for select using (ist_admin() or besitzer = auth.uid() or verantwortlich = auth.uid() or besitzer is null);

drop policy if exists aufgaben_aendern on public.aufgaben;
create policy aufgaben_aendern on public.aufgaben
  for update
  using       (ist_admin() or besitzer = auth.uid() or verantwortlich = auth.uid() or besitzer is null)
  with check  (ist_admin() or besitzer is not null);

-- Loeschen darf auch, wer die Aufgabe erledigen soll: wie am Whiteboard, wo
-- der Tafel-Besitzer wegwischen darf, was andere ihm hingeschrieben haben.
drop policy if exists aufgaben_loeschen on public.aufgaben;
create policy aufgaben_loeschen on public.aufgaben
  for delete using (ist_admin() or besitzer = auth.uid() or verantwortlich = auth.uid() or besitzer is null);

-- ---------------------------------------------------------------- Firmenname
-- Lukas gibt Louis eine Aufgabe zu SEINEM Kunden. Louis darf die Kundenakte
-- nicht lesen (firmen_lesen: Admin, Besitzer, gewonnen_durch) — der Join in
-- todoListe() liefert ihm darum keinen Namen, und die Liste sagte "Allgemein".
-- Das ist falsch: die Aufgabe hat einen Kunden, Louis darf nur die Akte nicht
-- sehen. Auf dem Whiteboard steht der Name ohnehin in der Zeile.
--
-- Diese Funktion gibt GENAU den Namen frei — und nur dem, der die Aufgabe
-- angelegt hat oder erledigen soll (oder einem Admin). Nicht mehr: keine
-- Telefonnummer, keine Adresse, kein Link in die Akte (die Oberflaeche zeigt
-- den Namen dann ohne Link). SECURITY DEFINER, weil sie an der RLS von firmen
-- vorbeilesen muss; search_path festgenagelt, damit niemand ihr eine andere
-- Tabelle unterschiebt.
create or replace function public.aufgabe_firma_name(p_aufgabe bigint)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select f.name
    from public.aufgaben a
    join public.firmen f on f.id = a.firma_id
   where a.id = p_aufgabe
     and (a.besitzer = auth.uid() or a.verantwortlich = auth.uid() or public.ist_admin())
$$;

revoke all on function public.aufgabe_firma_name(bigint) from public;
grant execute on function public.aufgabe_firma_name(bigint) to authenticated, service_role;

-- ---------------------------------------------------------------- Haken Liste -> Tafel
-- Wer eine Aufgabe in der Liste abhakt, hakt ihre Zeile auf dem Whiteboard mit
-- ab. Das Element gehoert aber nicht immer dem, der abhakt: Louis darf die
-- Zeile in einen EIGENEN Block ziehen — dann sind Autor und Tafel-Besitzer
-- des Elements beide Louis, und Lukas (Anleger der Aufgabe) kaeme mit der
-- RLS von whiteboard_elemente (besitzer oder tafel) nicht mehr an die Zeile.
-- Sein Haken in der Liste bliebe auf der Tafel unsichtbar (Pruefung 05.09.).
--
-- Darum schreibt diese Funktion den Haken am RLS vorbei (SECURITY DEFINER) —
-- aber nur, wenn der Aufrufer die Aufgabe angelegt hat oder erledigen soll,
-- nur in DEM Element, das an der Aufgabe vermerkt ist (tafel_element), und
-- nur in Zeilen mit genau diesem Aufgaben-Bezug. Mehr kann sie nicht: keinen
-- Text, keine fremden Zeilen, kein anderes Element. Der Trigger
-- whiteboard_elemente_beruehrt erhoeht dabei Version und Zeitstempel, damit
-- die offenen Browser die Aenderung ueber den Delta-Abgleich bekommen.
--
-- Rueckgabe (Text, damit der Aufrufer weiss, was los war):
--   ok            geschrieben
--   unveraendert  die Zeile stand schon so
--   zeile         keine Zeile mit diesem Bezug im Element (z. B. geloescht)
--   geloescht     Element ist weich geloescht (Bezug bleibt, Undo bringt es zurueck)
--   weg           Element gibt es nicht (mehr) — der Aufrufer loest den Bezug
--   kein-bezug    Aufgabe steht auf keiner Tafel
--   recht         Aufrufer ist weder Besitzer noch Verantwortlicher
--   aufgabe       Aufgabe unbekannt
create or replace function public.aufgabe_haken_auf_tafel(p_aufgabe bigint, p_erledigt boolean)
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
begin
  select id, besitzer, verantwortlich, tafel_element into a from public.aufgaben where id = p_aufgabe;
  if not found then return 'aufgabe'; end if;
  if auth.uid() is null
     or (a.besitzer is distinct from auth.uid() and a.verantwortlich is distinct from auth.uid()) then
    return 'recht';
  end if;
  if a.tafel_element is null then return 'kein-bezug'; end if;

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
                then jsonb_set(z, '{erledigt}', to_jsonb(p_erledigt))
                else z end
           order by ord), '[]'::jsonb))
    into neu
    from jsonb_array_elements(alt->'zeilen') with ordinality as t(z, ord);

  if neu = alt then return 'unveraendert'; end if;
  update public.whiteboard_elemente set inhalt = neu::text where id = e.id;
  return 'ok';
end;
$$;

revoke all on function public.aufgabe_haken_auf_tafel(bigint, boolean) from public;
grant execute on function public.aufgabe_haken_auf_tafel(bigint, boolean) to authenticated, service_role;
