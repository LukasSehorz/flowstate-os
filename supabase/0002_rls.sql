-- =====================================================================
-- Flowstate CRM — Row-Level-Security (Migration 0002)
-- Setzt E1 in Postgres durch:
--   Rolle 'mitarbeiter' (Ioannis, Louis, Simon) -> NUR eigene Datensaetze
--   Rolle 'admin'       (Lukas, Jannik)         -> sieht/bearbeitet ALLES
-- Frontend-Filter sind nur Komfort; die Wahrheit steht hier.
-- Muster uebernommen aus dem Estera CRM (0002_rls.sql).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Hilfsfunktion: Ist der aktuelle Nutzer Admin?
-- SECURITY DEFINER, damit der Lesezugriff auf profiles nicht erneut RLS
-- ausloest (sonst Endlos-Rekursion in den profiles-Policies).
-- ---------------------------------------------------------------------
create or replace function public.ist_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and rolle = 'admin' and aktiv = true
  );
$$;

-- RLS auf allen Tabellen einschalten
alter table public.profiles          enable row level security;
alter table public.firmen            enable row level security;
alter table public.kontakte          enable row level security;
alter table public.deals             enable row level security;
alter table public.projekte          enable row level security;
alter table public.aktivitaeten      enable row level security;
alter table public.aufgaben          enable row level security;
alter table public.dokumente         enable row level security;
alter table public.call_listen       enable row level security;
alter table public.call_listen_eintraege enable row level security;
alter table public.pipeline_stages   enable row level security;

-- ---------------------------------------------------------------------
-- profiles: jeder sieht das Team (fuer Namensanzeige), aendern nur Admin
-- ---------------------------------------------------------------------
drop policy if exists profiles_lesen on public.profiles;
create policy profiles_lesen on public.profiles
  for select using (auth.uid() is not null);

drop policy if exists profiles_aendern on public.profiles;
create policy profiles_aendern on public.profiles
  for update using (public.ist_admin() or id = auth.uid());

drop policy if exists profiles_anlegen on public.profiles;
create policy profiles_anlegen on public.profiles
  for insert with check (public.ist_admin() or id = auth.uid());

-- ---------------------------------------------------------------------
-- pipeline_stages: alle lesen, nur Admin aendern
-- ---------------------------------------------------------------------
drop policy if exists stages_lesen on public.pipeline_stages;
create policy stages_lesen on public.pipeline_stages
  for select using (auth.uid() is not null);

drop policy if exists stages_pflegen on public.pipeline_stages;
create policy stages_pflegen on public.pipeline_stages
  for all using (public.ist_admin()) with check (public.ist_admin());

-- ---------------------------------------------------------------------
-- firmen: Admin alles, Mitarbeiter nur eigene (oder herrenlose)
-- ---------------------------------------------------------------------
drop policy if exists firmen_lesen on public.firmen;
create policy firmen_lesen on public.firmen
  for select using (public.ist_admin() or besitzer = auth.uid() or besitzer is null);

drop policy if exists firmen_anlegen on public.firmen;
create policy firmen_anlegen on public.firmen
  for insert with check (auth.uid() is not null);

drop policy if exists firmen_aendern on public.firmen;
create policy firmen_aendern on public.firmen
  for update using (public.ist_admin() or besitzer = auth.uid())
  with check (public.ist_admin() or besitzer = auth.uid());

-- E11 / A7: Loeschen nur Admin (Mitarbeiter koennen nur schliessen)
drop policy if exists firmen_loeschen on public.firmen;
create policy firmen_loeschen on public.firmen
  for delete using (public.ist_admin());

-- ---------------------------------------------------------------------
-- kontakte: Zugriff folgt der Firma
-- ---------------------------------------------------------------------
drop policy if exists kontakte_alle on public.kontakte;
create policy kontakte_alle on public.kontakte
  for all using (
    public.ist_admin() or exists (
      select 1 from public.firmen f where f.id = kontakte.firma_id
        and (f.besitzer = auth.uid() or f.besitzer is null)
    )
  )
  with check (
    public.ist_admin() or exists (
      select 1 from public.firmen f where f.id = kontakte.firma_id
        and (f.besitzer = auth.uid() or f.besitzer is null)
    )
  );

-- ---------------------------------------------------------------------
-- deals: Admin alles, Mitarbeiter nur eigene
-- ---------------------------------------------------------------------
drop policy if exists deals_lesen on public.deals;
create policy deals_lesen on public.deals
  for select using (public.ist_admin() or besitzer = auth.uid() or besitzer is null);

drop policy if exists deals_anlegen on public.deals;
create policy deals_anlegen on public.deals
  for insert with check (auth.uid() is not null);

drop policy if exists deals_aendern on public.deals;
create policy deals_aendern on public.deals
  for update using (public.ist_admin() or besitzer = auth.uid())
  with check (public.ist_admin() or besitzer = auth.uid());

drop policy if exists deals_loeschen on public.deals;
create policy deals_loeschen on public.deals
  for delete using (public.ist_admin());

-- ---------------------------------------------------------------------
-- projekte: dito (E1 — "Die drei machen Sales UND Delivery")
-- ---------------------------------------------------------------------
drop policy if exists projekte_lesen on public.projekte;
create policy projekte_lesen on public.projekte
  for select using (public.ist_admin() or besitzer = auth.uid() or besitzer is null);

drop policy if exists projekte_anlegen on public.projekte;
create policy projekte_anlegen on public.projekte
  for insert with check (auth.uid() is not null);

drop policy if exists projekte_aendern on public.projekte;
create policy projekte_aendern on public.projekte
  for update using (public.ist_admin() or besitzer = auth.uid())
  with check (public.ist_admin() or besitzer = auth.uid());

drop policy if exists projekte_loeschen on public.projekte;
create policy projekte_loeschen on public.projekte
  for delete using (public.ist_admin());

-- ---------------------------------------------------------------------
-- aktivitaeten: Historie folgt der Firma. Nie loeschbar (A7: Historie bleibt)
-- ---------------------------------------------------------------------
drop policy if exists akt_lesen on public.aktivitaeten;
create policy akt_lesen on public.aktivitaeten
  for select using (
    public.ist_admin() or firma_id is null or exists (
      select 1 from public.firmen f where f.id = aktivitaeten.firma_id
        and (f.besitzer = auth.uid() or f.besitzer is null)
    )
  );

drop policy if exists akt_anlegen on public.aktivitaeten;
create policy akt_anlegen on public.aktivitaeten
  for insert with check (auth.uid() is not null);

-- ---------------------------------------------------------------------
-- aufgaben
-- ---------------------------------------------------------------------
drop policy if exists aufgaben_alle on public.aufgaben;
create policy aufgaben_alle on public.aufgaben
  for all using (public.ist_admin() or besitzer = auth.uid() or besitzer is null)
  with check (public.ist_admin() or besitzer = auth.uid() or besitzer is null);

-- ---------------------------------------------------------------------
-- dokumente: folgt der Firma, loeschen nur Admin
-- ---------------------------------------------------------------------
drop policy if exists dok_lesen on public.dokumente;
create policy dok_lesen on public.dokumente
  for select using (
    public.ist_admin() or exists (
      select 1 from public.firmen f where f.id = dokumente.firma_id
        and (f.besitzer = auth.uid() or f.besitzer is null)
    )
  );

drop policy if exists dok_anlegen on public.dokumente;
create policy dok_anlegen on public.dokumente
  for insert with check (auth.uid() is not null);

drop policy if exists dok_loeschen on public.dokumente;
create policy dok_loeschen on public.dokumente
  for delete using (public.ist_admin());

-- ---------------------------------------------------------------------
-- call_listen
-- ---------------------------------------------------------------------
drop policy if exists listen_alle on public.call_listen;
create policy listen_alle on public.call_listen
  for all using (public.ist_admin() or besitzer = auth.uid() or besitzer is null)
  with check (public.ist_admin() or besitzer = auth.uid() or besitzer is null);

drop policy if exists listen_eintraege_alle on public.call_listen_eintraege;
create policy listen_eintraege_alle on public.call_listen_eintraege
  for all using (
    public.ist_admin() or exists (
      select 1 from public.call_listen l where l.id = call_listen_eintraege.liste_id
        and (l.besitzer = auth.uid() or l.besitzer is null)
    )
  )
  with check (
    public.ist_admin() or exists (
      select 1 from public.call_listen l where l.id = call_listen_eintraege.liste_id
        and (l.besitzer = auth.uid() or l.besitzer is null)
    )
  );

-- ---------------------------------------------------------------------
-- Automatik: neue Auth-Nutzer bekommen automatisch ein Profil
-- ---------------------------------------------------------------------
create or replace function public.neuer_nutzer()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  insert into public.profiles (id, name, rolle)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'rolle', 'mitarbeiter')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.neuer_nutzer();
