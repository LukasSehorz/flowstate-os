-- =====================================================================
-- Flowstate — Listen-Boards "Kunden" und "Leads" haengen an der Akte
-- (Migration 0070, 14.09.2026, Wunsch von Lukas)
--
-- Bisher (0068) war jede Zeile freier Text: Firma | Aufgabe | Preis. Jetzt
-- waehlt man die Firma aus dem CRM, und die Zeile hat vier Spalten:
--   Kunde bzw. Lead (firma_id) | Notiz 1 | Notiz 2 | Bezahlt (frei: Ja/Nein)
--
-- Warum eine firma_id: Was auf der Tafel eingetragen wird, soll von selbst
-- in der passenden Akte stehen (lib/whiteboard-routes.js schreibt dafuer in
-- aktivitaeten). Das geht nur, wenn die Zeile weiss, WELCHE Firma gemeint
-- ist — ein getippter Name reicht dafuer nicht.
--
-- firma_name haelt den Namen zum Zeitpunkt der Auswahl fest. Die Tafel sieht
-- das ganze Team, die Firmen aber nur, wer sie sehen darf (Zeilenrechte auf
-- firmen). Ohne die Kopie stuende bei einem Mitarbeiter eine leere Zelle, wo
-- sein Kollege "Geißler Garten" eingetragen hat.
--
-- on delete cascade: Wird eine Firma geloescht, verschwindet auch ihre
-- Tafelzeile — eine Zeile zu einer Firma, die es nicht mehr gibt, waere nur
-- noch Rauschen.
-- =====================================================================

alter table public.whiteboard_listenzeilen
  add column if not exists firma_id   bigint references public.firmen(id) on delete cascade,
  add column if not exists firma_name text not null default '',
  add column if not exists notiz1     text not null default '',
  add column if not exists notiz2     text not null default '',
  add column if not exists bezahlt    text not null default '';

-- Was schon in den alten freien Feldern stand, geht nicht verloren.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'whiteboard_listenzeilen'
                and column_name = 'aufgabe') then
    execute $u$
      update public.whiteboard_listenzeilen
         set firma_name = firma, notiz1 = aufgabe, notiz2 = preis
       where firma_name = '' and notiz1 = '' and notiz2 = ''
    $u$;
  end if;
end $$;

alter table public.whiteboard_listenzeilen
  drop column if exists firma,
  drop column if exists aufgabe,
  drop column if exists preis;

create index if not exists whiteboard_listenzeilen_firma
  on public.whiteboard_listenzeilen (firma_id);

comment on table public.whiteboard_listenzeilen is
  'Zwei feste Listen-Boards an der Whiteboard-Wand: Kunden und Leads. '
  'Je Zeile eine Firma aus dem CRM, zwei Notizen und "bezahlt". Neue Notizen '
  'landen zusaetzlich im Verlauf der Akte (aktivitaeten).';
