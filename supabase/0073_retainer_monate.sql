-- =====================================================================
-- Flowstate — Monatsrechnungen je Retainer-Kunde (Migration 0073, 20.09.2026)
--
-- Wunsch von Lukas: "Bei den Retainer-Kunden muss man das monatlich angeben
-- können — Rechnung für Oktober verschickt ja/nein, bezahlt ja/nein, dann
-- November, dann Dezember." Bisher gab es nur einen Zähler
-- (firmen.retainer_monate_bezahlt): "3 Monate bezahlt" sagt nicht, WELCHE
-- drei, und ob für den vierten schon eine Rechnung draussen ist.
--
-- Eine Zeile je Kunde und Monat. Der Monat ist immer der 1. des Monats.
-- Gezaehlt wird ab dem Monat NACH dem Abschluss — so, wie der Umsatz anfaellt
-- (lib/crm.js, umsatzAnfall) und wie Lukas es fuer Anderka beschrieben hat:
-- im September gewonnen, erste Monatsrechnung im Oktober.
--
-- Die Einnahmen der Buchhaltung entstehen aus den BEZAHLTEN Zeilen
-- (lib/crm.js, einnahmeAusAkte) — der alte Zaehler wird nur noch mitgefuehrt,
-- damit nichts bricht, was ihn noch liest.
-- =====================================================================

create table if not exists public.retainer_monate (
  id        bigserial primary key,
  firma_id  bigint not null references public.firmen(id) on delete cascade,
  monat     date not null,
  gestellt  boolean not null default false,
  bezahlt   boolean not null default false,
  erstellt  timestamptz not null default now(),
  geaendert timestamptz not null default now(),
  unique (firma_id, monat)
);

create index if not exists retainer_monate_firma on public.retainer_monate (firma_id, monat);

comment on table public.retainer_monate is
  'Je Retainer-Kunde und Monat: Rechnung gestellt? bezahlt? Monat = 1. des Monats, '
  'beginnend im Monat nach dem Abschluss.';

-- Bestand uebernehmen: Monate aus Abschlussdatum und Laufzeit, die ersten
-- n als gestellt und bezahlt markiert (n = bisheriger Zaehler).
insert into public.retainer_monate (firma_id, monat, gestellt, bezahlt)
select f.id,
       (date_trunc('month', f.kunde_seit) + (n || ' months')::interval)::date,
       n <= coalesce(f.retainer_monate_bezahlt, 0),
       n <= coalesce(f.retainer_monate_bezahlt, 0)
  from public.firmen f
  cross join lateral generate_series(1, case f.vertrag_laufzeit
      when '1 Monat' then 1
      when '3 Monate' then 3
      when '6 Monate' then 6
      when '12 Monate' then 12
      when 'Unbegrenzt · monatlich kündbar' then 12
      else 0 end) as n
 where f.status = 'kunde' and coalesce(f.preis_monatlich, 0) > 0 and f.kunde_seit is not null
on conflict (firma_id, monat) do nothing;

-- Wurde die Rechnung fuer das Setup schon verschickt? (Die Frage "bezahlt"
-- beantworten rechnung_stand und bezahlt_betrag bereits.)
alter table public.firmen
  add column if not exists setup_gestellt boolean not null default false;

comment on column public.firmen.setup_gestellt is
  'Rechnung fuer Setup/Projekt verschickt? Bezahlt-Status steckt in rechnung_stand/bezahlt_betrag.';

-- ---------------------------------------------------------------------
-- Rechte: wer die Firma sehen darf, sieht ihre Monate; wer sie aendern darf,
-- aendert sie. Dieselbe Regel wie auf firmen selbst.
-- ---------------------------------------------------------------------
alter table public.retainer_monate enable row level security;

drop policy if exists retainer_monate_lesen on public.retainer_monate;
create policy retainer_monate_lesen on public.retainer_monate for select using (
  exists (select 1 from public.firmen f where f.id = retainer_monate.firma_id
            and (ist_admin() or f.besitzer = auth.uid() or f.gewonnen_durch = auth.uid() or f.besitzer is null)));

drop policy if exists retainer_monate_schreiben on public.retainer_monate;
create policy retainer_monate_schreiben on public.retainer_monate for all using (
  exists (select 1 from public.firmen f where f.id = retainer_monate.firma_id
            and (ist_admin() or f.besitzer = auth.uid())))
  with check (exists (select 1 from public.firmen f where f.id = retainer_monate.firma_id
            and (ist_admin() or f.besitzer = auth.uid())));

grant select, insert, update, delete on public.retainer_monate to authenticated;
grant usage, select on sequence public.retainer_monate_id_seq to authenticated;
