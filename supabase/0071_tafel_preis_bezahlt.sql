-- =====================================================================
-- Flowstate — Listen-Tafeln: Preis statt zweiter Notiz, Bezahlt als Auswahl
-- (Migration 0071, 20.09.2026, Wunsch von Lukas)
--
-- Je Zeile steht jetzt: Kunde/Lead · Notiz · Preis · Bezahlt.
--
-- PREIS ist bewusst FREITEXT und keine Zahl: "manchmal haben wir monatliche
-- Gebuehren noch dabei, manchmal nicht" — "4.500 € + 250 €/Monat" gehoert
-- genauso hinein wie "1.800 €". Eine Zahlenspalte koennte das nicht halten,
-- und die belastbaren Betraege stehen ohnehin in der Akte (preis_setup,
-- preis_monatlich), aus denen Umsatz und Pipeline gerechnet werden.
--
-- BEZAHLT ist jetzt eine feste Auswahl: '' (offen gelassen), 'ganz', '50%'
-- oder 'nein'. Als Freitext meinten "Ja", "ja" und "bezahlt" dasselbe und
-- standen trotzdem verschieden da. Geprueft wird im Server
-- (lib/whiteboard-routes.js, BEZAHLT_WERTE) UND hier, damit kein anderer Weg
-- etwas anderes hineinschreiben kann.
-- =====================================================================

alter table public.whiteboard_listenzeilen
  rename column notiz2 to preis;

-- Was frueher frei getippt wurde, auf die drei Werte bringen.
update public.whiteboard_listenzeilen set bezahlt = case
    when lower(btrim(bezahlt)) in ('ja', 'ganz', 'bezahlt', 'voll', 'komplett') then 'ganz'
    when lower(btrim(bezahlt)) in ('50', '50%', '50 %', 'halb', 'haelfte', 'hälfte') then '50%'
    when lower(btrim(bezahlt)) in ('nein', 'no', 'offen', 'nicht bezahlt') then 'nein'
    else ''
  end
 where bezahlt <> '' and bezahlt not in ('ganz', '50%', 'nein');

alter table public.whiteboard_listenzeilen
  drop constraint if exists whiteboard_listenzeilen_bezahlt_check;
alter table public.whiteboard_listenzeilen
  add constraint whiteboard_listenzeilen_bezahlt_check
  check (bezahlt in ('', 'ganz', '50%', 'nein'));

comment on table public.whiteboard_listenzeilen is
  'Zwei feste Listen-Tafeln an der Whiteboard-Wand: Kunden und Leads. '
  'Je Zeile eine Firma aus dem CRM, eine Notiz, ein freier Preis und '
  'bezahlt (ganz/50%/nein). Neue Eintraege landen im Verlauf der Akte.';
