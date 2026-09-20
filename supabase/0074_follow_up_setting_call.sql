-- 0074 — "Follow-up nach Setting Call" im KI-Verkauf (20.09.2026)
--
-- Warum: Nach dem Setting Call entscheidet kaum jemand sofort, ob er den
-- KI-Workshop bucht. Bis jetzt musste die Karte dafuer im Setting Call stehen
-- bleiben — man sah also nicht, ob das Gespraech noch aussteht oder schon
-- gelaufen ist. Im Webdesign gibt es die Phase seit Migration 0053
-- ("Follow-up nach Erstgespräch"), im KI-Verkauf fehlte sie.
--
-- Die Abschlusschance bleibt bei 45 % — gleich wie der Setting Call selbst
-- (Vorgabe Lukas). Ein gelaufenes Gespraech ohne Zusage ist weder besser noch
-- schlechter als eines, das noch bevorsteht. Die Quote steht in
-- lib/pipeline-quoten.js, hier geht es nur um die Spalte.
--
-- Positionen: erst alle nach hinten schieben (+1000), damit ein eindeutiger
-- Index auf (sparte, art, position) nicht mitten im Umnummerieren anschlaegt,
-- dann sauber neu durchzaehlen. Dieselbe Reihenfolge wie in 0069.

-- 1. Platz schaffen
update public.pipeline_stages
   set position = position + 1000
 where sparte = 'ki' and art = 'vertrieb';

-- 2. Die neue Spalte anlegen (nur, wenn es sie noch nicht gibt).
-- 2004 und nicht 1004: Nach dem Verschieben oben sitzt der KI-Workshop auf
-- 1004 — der eindeutige Index auf (sparte, art, position) haette genau hier
-- zugeschlagen. Die Zahl ist ohnehin nur ein Zwischenstand.
insert into public.pipeline_stages (sparte, art, position, name, ist_abschluss, ist_verlust)
select 'ki', 'vertrieb', 2004, 'Follow-up nach Setting Call', false, false
 where not exists (
   select 1 from public.pipeline_stages
    where sparte = 'ki' and art = 'vertrieb' and name = 'Follow-up nach Setting Call');

-- 3. Endgueltige Reihenfolge
update public.pipeline_stages set position = 1  where sparte='ki' and art='vertrieb' and name='Neu';
update public.pipeline_stages set position = 2  where sparte='ki' and art='vertrieb' and name='Follow-up';
update public.pipeline_stages set position = 3  where sparte='ki' and art='vertrieb' and name='Setting Call';
update public.pipeline_stages set position = 4  where sparte='ki' and art='vertrieb' and name='Follow-up nach Setting Call';
update public.pipeline_stages set position = 5  where sparte='ki' and art='vertrieb' and name='KI-Workshop';
update public.pipeline_stages set position = 6  where sparte='ki' and art='vertrieb' and name='KI-Masterplan versendet';
update public.pipeline_stages set position = 7  where sparte='ki' and art='vertrieb' and name='Sales-Call';
update public.pipeline_stages set position = 8  where sparte='ki' and art='vertrieb' and name='Follow-up nach Sales-Call';
update public.pipeline_stages set position = 9  where sparte='ki' and art='vertrieb' and name='Gewonnen';
update public.pipeline_stages set position = 10 where sparte='ki' and art='vertrieb' and name='Verloren';

-- 4. Nichts darf im Zwischenraum haengen bleiben
do $$
declare uebrig int;
begin
  select count(*) into uebrig from public.pipeline_stages
   where sparte='ki' and art='vertrieb' and position > 100;
  if uebrig > 0 then
    raise exception 'KI-Verkauf: % Stufe(n) ohne neue Position — Namen pruefen', uebrig;
  end if;
end $$;
