-- =====================================================================
-- Flowstate — Hochgeladene Listen sichtbar und filterbar (Migration 0053)
--
-- Gewuenscht am 18.08.2026: In der Cold-Calling-Ansicht soll man sehen, WANN
-- ein Lead hochgeladen wurde, und nach der hochgeladenen LISTE filtern koennen.
--
-- Warum die Branche dafuer nicht reicht: Eine Liste wie
-- "Leads_GF-Handy_Bayern_2026-08-18" enthaelt absichtlich gemischte Branchen —
-- gesucht waren Geschaeftsfuehrer-Handynummern, nicht ein Gewerk. Wer nur nach
-- "Handwerk & Bau" filtern kann, bekommt diese Liste nie als Ganzes zu sehen.
-- Und wer nur nach dem Tag filtert, wirft zwei Uploads desselben Tages
-- zusammen.
--
-- Neue Tabellen braucht es dafuer nicht: call_listen und
-- call_listen_eintraege stehen seit Migration 0001 im Schema, mitsamt
-- Rechteregeln aus 0002 ("Physiotherapie Muenchen Juli" steht dort als
-- Beispiel). Benutzt hat sie bisher nur niemand. Diese Migration macht sie
-- benutzbar: Indizes fuer den Weg Lead -> Liste, und der Altbestand bekommt
-- rueckwirkend seine Listen.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Indizes
-- ---------------------------------------------------------------------
-- Der Primaerschluessel ist (liste_id, firma_id) — er beantwortet "welche
-- Firmen sind in Liste X". Die Anzeige fragt aber andersherum: "aus welcher
-- Liste stammt dieser Lead", einmal pro Zeile. Ohne diesen Index waere das
-- ein Durchlauf durch die ganze Tabelle je Zeile.
create index if not exists idx_listen_eintraege_firma
  on public.call_listen_eintraege(firma_id);

-- Fuer das Auswahlfeld: die Listen einer Person, neueste zuerst.
create index if not exists idx_call_listen_besitzer
  on public.call_listen(besitzer, erstellt desc);

-- Ohne Webseite = bestes Verkaufsargument, danach wird gefiltert. Der Index
-- deckt genau die Bedingung ab, die lib/crm.js dafuer stellt.
create index if not exists idx_firmen_ohne_website
  on public.firmen(status) where website is null;

-- ---------------------------------------------------------------------
-- 2) Altbestand nachtragen
-- ---------------------------------------------------------------------
-- 818 Leads liegen bereits in der Datenbank, keiner davon in einer Liste.
-- Ohne diesen Schritt zeigte der neue Filter erst ab dem naechsten Upload
-- etwas an — der gesamte bisherige Bestand waere unfilterbar.
--
-- Woran erkennt man im Nachhinein, was zusammen hochgeladen wurde? Am
-- Zeitstempel: Ein Upload legt seine Leads in einem Zug an, Sekunden bis
-- wenige Minuten auseinander. Zwischen zwei Uploads liegen Stunden. Wir
-- schneiden deshalb bei einer Luecke von mehr als 30 Minuten — und getrennt
-- je Besitzer, denn zwei Personen koennen zur selben Zeit hochladen.
--
-- Wiederholbar: Es werden nur Leads betrachtet, die noch in KEINER Liste
-- stehen. Beim zweiten Lauf findet der Block nichts mehr und tut nichts.
do $$
declare
  g          record;
  neue_liste bigint;
  nummer     int;
  beschriftung text;
begin
  for g in
    with offen as (
      -- Nur was noch keiner Liste zugeordnet ist.
      select f.id, f.besitzer, f.erstellt
        from public.firmen f
       where f.status = 'lead'
         and not exists (
           select 1 from public.call_listen_eintraege e where e.firma_id = f.id)
    ),
    markiert as (
      -- 1 = hier beginnt eine neue Charge (erster Eintrag oder Luecke > 30 Min)
      select id, besitzer, erstellt,
             case
               when lag(erstellt) over (partition by besitzer order by erstellt) is null
                 or erstellt - lag(erstellt) over (partition by besitzer order by erstellt)
                    > interval '30 minutes'
               then 1 else 0
             end as beginnt
        from offen
    ),
    nummeriert as (
      select id, besitzer, erstellt,
             sum(beginnt) over (
               partition by besitzer order by erstellt
               rows between unbounded preceding and current row) as charge
        from markiert
    )
    select besitzer,
           charge,
           min(erstellt) as beginn,
           count(*)::int as anzahl,
           array_agg(id)  as firmen_ids
      from nummeriert
     group by besitzer, charge
     order by besitzer, min(erstellt)
  loop
    -- Mehrere Uploads am selben Tag bekommen eine laufende Nummer, sonst
    -- stuenden im Auswahlfeld zwei gleich beschriftete Eintraege.
    select count(*) + 1 into nummer
      from public.call_listen l
     where l.besitzer is not distinct from g.besitzer
       and (l.erstellt at time zone 'Europe/Berlin')::date
           = (g.beginn at time zone 'Europe/Berlin')::date;

    beschriftung := 'Liste vom '
      || to_char(g.beginn at time zone 'Europe/Berlin', 'DD.MM.YYYY')
      || case when nummer > 1 then ' (' || nummer || ')' else '' end;

    insert into public.call_listen (name, besitzer, erstellt)
    values (beschriftung, g.besitzer, g.beginn)
    returning id into neue_liste;

    insert into public.call_listen_eintraege (liste_id, firma_id)
    select neue_liste, unnest(g.firmen_ids)
    on conflict do nothing;

    raise notice 'Liste angelegt: % (% Leads)', beschriftung, g.anzahl;
  end loop;
end $$;
