-- 0076 — Setting Call und KI-Workshop sind dasselbe (20.09.2026)
--
-- Lukas: "Bei Verkauf KI sind Setting Call und KI-Workshop das gleiche. Dort
-- machst du 44 % Wahrscheinlichkeit."
--
-- Zwei Spalten fuer ein und dasselbe Gespraech hiessen: Jede Karte musste
-- willkuerlich in eine von beiden — und die Pipeline haette je nach Wahl 33 %
-- oder 44 % gerechnet. Also eine Spalte.
--
-- Der Name faengt bewusst mit "Setting Call" an und nicht mit "KI-Workshop".
-- Zwei Stellen suchen die Gespraechsphase ueber den Namen (das Anrufergebnis
-- "Erstgespräch gebucht" und die Team-Auswertung). Die vertragen jetzt zwar
-- beides (siehe lib/crm.js), aber die Reihenfolge im Namen ist trotzdem kein
-- Zufall: Zuerst wird terminiert, dann kommt der Workshop.
--
-- Was mit den Karten passiert: Im KI-Workshop steht aktuell keine einzige.
-- Der Umzug unten laeuft trotzdem, weil sich das bis zum Einspielen aendern
-- kann — eine Spalte zu loeschen, in der noch Karten stehen, waere der
-- teuerste denkbare Fehler.

-- 1. Karten aus dem KI-Workshop in den Setting Call
update public.deals d
   set stufe_id = (select id from public.pipeline_stages
                    where sparte='ki' and art='vertrieb' and name='Setting Call')
 where d.stufe_id = (select id from public.pipeline_stages
                      where sparte='ki' and art='vertrieb' and name='KI-Workshop');

-- 2. Die leere Spalte entfernen
delete from public.pipeline_stages
 where sparte='ki' and art='vertrieb' and name='KI-Workshop';

-- 3. Umbenennen
update public.pipeline_stages set name='Setting Call / KI-Workshop'
 where sparte='ki' and art='vertrieb' and name='Setting Call';
update public.pipeline_stages set name='Follow-up nach Setting Call / KI-Workshop'
 where sparte='ki' and art='vertrieb' and name='Follow-up nach Setting Call';

-- 4. Luecke schliessen (Positionen 1..9, ohne Sprung)
update public.pipeline_stages set position = position + 1000
 where sparte='ki' and art='vertrieb';
update public.pipeline_stages set position = 1 where sparte='ki' and art='vertrieb' and name='Neu';
update public.pipeline_stages set position = 2 where sparte='ki' and art='vertrieb' and name='Follow-up';
update public.pipeline_stages set position = 3 where sparte='ki' and art='vertrieb' and name='Setting Call / KI-Workshop';
update public.pipeline_stages set position = 4 where sparte='ki' and art='vertrieb' and name='Follow-up nach Setting Call / KI-Workshop';
update public.pipeline_stages set position = 5 where sparte='ki' and art='vertrieb' and name='KI-Masterplan versendet';
update public.pipeline_stages set position = 6 where sparte='ki' and art='vertrieb' and name='Sales-Call';
update public.pipeline_stages set position = 7 where sparte='ki' and art='vertrieb' and name='Follow-up nach Sales-Call';
update public.pipeline_stages set position = 8 where sparte='ki' and art='vertrieb' and name='Gewonnen';
update public.pipeline_stages set position = 9 where sparte='ki' and art='vertrieb' and name='Verloren';

-- 5. Wache: keine Stufe ohne neue Position, keine Karte ohne Stufe
do $$
declare uebrig int; waisen int;
begin
  select count(*) into uebrig from public.pipeline_stages
   where sparte='ki' and art='vertrieb' and position > 100;
  if uebrig > 0 then
    raise exception 'KI-Verkauf: % Stufe(n) ohne neue Position — Namen pruefen', uebrig;
  end if;
  select count(*) into waisen from public.deals d
   where d.sparte='ki' and d.stufe_id is not null
     and not exists (select 1 from public.pipeline_stages s where s.id = d.stufe_id);
  if waisen > 0 then
    raise exception '% KI-Deal(s) zeigen auf eine geloeschte Stufe', waisen;
  end if;
end $$;
