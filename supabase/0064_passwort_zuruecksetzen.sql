-- Passwort zuruecksetzen, ohne angemeldet zu sein (06.09.2026).
--
-- WARUM: Ioannis hatte sein Passwort vergessen. Aendern konnte man es bis
-- heute nur ANGEMELDET (Einstellungen) — was genau dann nicht hilft, wenn man
-- nicht mehr hineinkommt. Lukas: "Das kommt immer mal wieder vor, und dann
-- muss man es zuruecksetzen koennen, auch wenn man nicht ins System kommt."
--
-- WAS HIER LIEGT: nur der EINMAL-SCHLUESSEL, und zwar als Abdruck (SHA-256),
-- nie im Klartext. Wer die Tabelle liest, kann damit nichts anfangen — er
-- muesste den Schluessel selbst kennen, und der steht ausschliesslich in der
-- Mail an die Person. Dasselbe Prinzip wie beim Passwort selbst.
--
-- KEINE Verbindung zu auth.users per Fremdschluessel: Das Schema auth gehoert
-- Supabase, und ein Fremdschluessel dorthin haette bei jedem Loeschen eines
-- Kontos eine Hand im fremden Schema. Die Kennung reicht; verwaiste Zeilen
-- laufen ohnehin nach einer Stunde ab.

create table if not exists public.passwort_zuruecksetzen (
  id             bigserial primary key,
  nutzer         uuid        not null,
  schluessel_abdruck text    not null,
  gueltig_bis    timestamptz not null,
  benutzt_am     timestamptz,
  angefragt_von  text,
  erstellt       timestamptz not null default now()
);

create index if not exists pwz_abdruck  on public.passwort_zuruecksetzen (schluessel_abdruck);
create index if not exists pwz_nutzer   on public.passwort_zuruecksetzen (nutzer, erstellt desc);

comment on table public.passwort_zuruecksetzen is
  'Einmal-Schluessel fuer "Passwort vergessen". Nur der SHA-256-Abdruck, nie der Schluessel selbst. Eine Stunde gueltig, danach wertlos.';
comment on column public.passwort_zuruecksetzen.benutzt_am is
  'Gesetzt, sobald der Schluessel eingeloest wurde. Ein zweites Mal geht damit nicht.';
comment on column public.passwort_zuruecksetzen.angefragt_von is
  'Woher die Anfrage kam (IP). Nur zum Nachsehen, wenn jemand die Seite missbraucht.';

-- Niemand ausser dem Server (Dienstrolle) hat hier etwas zu suchen: Die
-- Anfrage kommt von einer NICHT angemeldeten Person, es gibt also keine
-- Zeilenrechte, an denen man sie festmachen koennte.
alter table public.passwort_zuruecksetzen enable row level security;
drop policy if exists pwz_niemand on public.passwort_zuruecksetzen;
create policy pwz_niemand on public.passwort_zuruecksetzen for all using (false) with check (false);
