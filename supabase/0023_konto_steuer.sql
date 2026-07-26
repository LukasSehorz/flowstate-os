-- =====================================================================
-- Flowstate — Kontostand und Steuer-Rücklage (Migration 0023)
--
-- KONTOSTAND: Die Lexware-Schnittstelle gibt keinen Kontostand heraus. Geprueft
-- am 26.07.2026: /v1/financial-accounts, /v1/bank-accounts, /v1/accounts,
-- /v1/transactions und /v1/financial-transactions antworten alle mit 404. Dass
-- das Bankkonto in Lexware verbunden ist, hilft dort — nicht hier.
--
-- Darum: Ein Startsaldo wird einmal eingetragen (Kontostand von heute), danach
-- rechnet die Uebersicht laufend mit: Startsaldo + Einnahmen - Ausgaben.
--
-- STEUERSATZ: Als Rueckstellung fuer die zu erwartende Steuer, standardmaessig
-- 30 % vom Gewinn. Frei einstellbar, weil der echte Satz von Rechtsform und
-- Gewinnhoehe abhaengt.
--
-- Eine Zeile pro Organisation — es gibt nur eine Firma, darum reicht id = 1.
-- =====================================================================

create table if not exists public.finanz_einstellungen (
  id             smallint primary key default 1 check (id = 1),
  start_saldo    numeric(12,2) not null default 0,
  saldo_stand    date,           -- zu welchem Tag der Startsaldo galt
  steuersatz     numeric(4,1) not null default 30.0,
  notiz          text,
  geaendert_von  uuid references public.profiles(id),
  geaendert      timestamptz not null default now()
);

insert into public.finanz_einstellungen (id) values (1) on conflict (id) do nothing;

alter table public.finanz_einstellungen enable row level security;

drop policy if exists finanz_einstellungen_admin on public.finanz_einstellungen;
create policy finanz_einstellungen_admin on public.finanz_einstellungen
  for all using (public.ist_admin()) with check (public.ist_admin());
