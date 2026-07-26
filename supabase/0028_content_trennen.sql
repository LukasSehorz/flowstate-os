-- =====================================================================
-- Flowstate — Content von Marketing trennen (Migration 0028)
--
-- 0027 hat beides in einen Bereich gelegt. In der taeglichen Arbeit sind das
-- aber zwei verschiedene Dinge:
--
--   CONTENT    Was wir selbst schreiben und posten — Redaktionsplan, Ausstoss,
--              Kanaele. Kostet Zeit, kein Geld.
--   MARKETING  Was wir einkaufen — Meta Ads, Google Ads, Kampagnen, Kosten je
--              Lead, Funnel. Kostet Geld.
--
-- An den Tabellen aendert sich fast nichts, sie waren schon getrennt geschnitten:
-- content_posts gehoert zu Content, kampagnen und kampagnen_zahlen zu Marketing.
--
-- Nur eine Tabelle sass auf der falschen Seite: marketing_einstellungen haelt das
-- WOCHENZIEL FUER POSTS — eine reine Content-Zahl. Sie heisst darum jetzt
-- content_einstellungen. Ein Name, der in den falschen Bereich zeigt, ist genau
-- die Sorte Kleinigkeit, ueber die man ein halbes Jahr spaeter stolpert.
-- =====================================================================

alter table if exists public.marketing_einstellungen rename to content_einstellungen;

-- Die Regeln wandern mit der Tabelle, tragen aber noch den alten Namen.
-- Umbenennen, damit im Katalog nichts auf einen Bereich zeigt, den es so nicht
-- mehr gibt.
do $$
begin
  if exists (select 1 from pg_policies
              where schemaname = 'public' and tablename = 'content_einstellungen'
                and policyname = 'marketing_einstellungen_lesen') then
    alter policy marketing_einstellungen_lesen on public.content_einstellungen
      rename to content_einstellungen_lesen;
  end if;
  if exists (select 1 from pg_policies
              where schemaname = 'public' and tablename = 'content_einstellungen'
                and policyname = 'marketing_einstellungen_aendern') then
    alter policy marketing_einstellungen_aendern on public.content_einstellungen
      rename to content_einstellungen_aendern;
  end if;
end $$;

-- Sicherstellen, dass die eine Zeile da ist (id = 1).
insert into public.content_einstellungen (id) values (1) on conflict (id) do nothing;

comment on table public.content_einstellungen is
  'Einstellungen des Content-Bereichs. posts_ziel_woche ist das Wochenziel, gegen das der Ausstoß gemessen wird.';
