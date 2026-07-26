-- =====================================================================
-- Flowstate — Eigenes Belegarchiv statt Lexware (Migration 0024)
--
-- WARUM: Lexware war bei uns nur ein Ablageort. Die Schnittstelle liest keine
-- Belege aus, gibt keinen Kontostand heraus und kann nichts loeschen. Alles,
-- was wir davon gebraucht haben, machen wir jetzt selbst — und weil die
-- Steuerberaterin die Belege ohnehin bekommt, braucht es dazwischen kein
-- zweites System.
--
-- Damit unser Archiv genauso belastbar ist wie ein Buchhaltungsprogramm,
-- braucht es vier Dinge. Die legt diese Migration an:
--
--   1) LAUFNUMMER  Jeder Beleg bekommt beim Eingang eine fortlaufende Nummer
--                  aus einer Sequenz. Lueckenlos und nicht nachtraeglich
--                  aenderbar — daran erkennt eine Pruefung, dass nichts fehlt.
--
--   2) PRUEFSUMME  SHA-256 ueber die Datei. Wer sie spaeter austauscht, aendert
--                  die Pruefsumme — der Tausch faellt auf.
--
--   3) UNVERAENDERBARKEIT  Ein Datenbank-Trigger verbietet DELETE komplett und
--                  blockt Aenderungen an Datei, Pruefsumme, Laufnummer und
--                  Eingangszeitpunkt. Das ist bewusst in der Datenbank und
--                  nicht im Programmcode: ein Trigger greift auch dann, wenn
--                  jemand direkt mit SQL an die Tabelle geht.
--
--   4) VERWERFEN STATT LOESCHEN  Ein Fehlscan verschwindet nicht, er wird auf
--                  status = 'verworfen' gesetzt, mit Grund und Zeitstempel.
--                  Er zaehlt dann nicht in den Buechern und nicht im
--                  Monatsordner, ist aber weiter nachweisbar.
--
-- BEZAHLT_AM: Ihr rechnet nach dem Zufluss-Prinzip (EUeR) — Geld zaehlt an dem
-- Tag, an dem es da ist. Darum entscheidet nicht das Rechnungsdatum, in welchen
-- Monatsordner eine Einnahme gehoert, sondern der Zahltag. Rechnung im Juli
-- geschrieben, Kunde zahlt im September -> September-Ordner.
--
-- Aufbewahrung: 8 Jahre fuer Buchungsbelege. Es wird nichts automatisch
-- geloescht — Aufraeumen ist eine bewusste Entscheidung, kein Nebeneffekt.
-- =====================================================================

-- ---------------------------------------------------------------- 1) Belege

-- Fortlaufende Nummer. Eigene Sequenz, damit sie unabhaengig von der id laeuft
-- und beim Aufraeumen von Testdaten keine Luecke in der Nummerierung entsteht.
create sequence if not exists public.beleg_laufnummer_seq as bigint start 1;

alter table public.belege add column if not exists laufnummer      bigint;
alter table public.belege add column if not exists pruefsumme      text;
alter table public.belege add column if not exists groesse         bigint;
alter table public.belege add column if not exists faellig         date;

-- Was beim Auslesen herauskam. lese_hinweis haelt fest, wobei sich das Modell
-- unsicher war — damit beim Pruefen klar ist, wo man zweimal hinschauen soll.
alter table public.belege add column if not exists gelesen         timestamptz;
alter table public.belege add column if not exists lese_hinweis    text;
alter table public.belege add column if not exists lese_modell     text;

-- Verwerfen statt Loeschen.
alter table public.belege add column if not exists verworfen_am    timestamptz;
alter table public.belege add column if not exists verworfen_von   uuid references public.profiles(id);
alter table public.belege add column if not exists verworfen_grund text;

-- Bestandsbelege nachnummerieren, aeltester zuerst, damit die Reihenfolge zum
-- Eingang passt. Danach die Sequenz hinter den hoechsten Wert setzen.
update public.belege b set laufnummer = n.nr
  from (select id, row_number() over (order by erstellt, id) as nr
          from public.belege where laufnummer is null) n
 where b.id = n.id and b.laufnummer is null;

select setval('public.beleg_laufnummer_seq',
              greatest(coalesce((select max(laufnummer) from public.belege), 0), 1));

alter table public.belege alter column laufnummer set default nextval('public.beleg_laufnummer_seq');

create unique index if not exists belege_laufnummer_idx on public.belege (laufnummer);

-- 'offen' stammt aus 0021 und ist seit 0022 kein gueltiger Zustand mehr —
-- buchungLoeschen hat den Wert aber weiter gesetzt. Erst aufraeumen, dann die
-- Regel um 'verworfen' erweitern.
update public.belege set status = 'neu' where status not in ('neu', 'gebucht', 'fehler', 'verworfen');

alter table public.belege drop constraint if exists belege_status_check;
alter table public.belege add constraint belege_status_check
  check (status in ('neu', 'gebucht', 'fehler', 'verworfen'));

-- ------------------------------------------------- 2) Unveraenderbarkeit
--
-- security definer, damit der Schutz auch fuer die authenticated-Rolle greift.
-- Was hier durchgeht, ist bewusst erlaubt: Werte pruefen und korrigieren
-- (Betrag, Datum, Kategorie, Gegenstelle) muss moeglich bleiben, sonst kann man
-- einen falsch gelesenen Beleg nie richtigstellen. Was NICHT durchgeht, ist
-- alles, was den Beleg selbst betrifft.
create or replace function public.belege_schutz() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    raise exception
      'Belege dürfen nicht gelöscht werden (Aufbewahrungspflicht). Setze status = ''verworfen'' mit Grund.';
  end if;

  if old.daten is not null and new.daten is distinct from old.daten then
    raise exception 'Die Belegdatei darf nicht ersetzt oder geleert werden (Aufbewahrungspflicht).';
  end if;
  if old.pruefsumme is not null and new.pruefsumme is distinct from old.pruefsumme then
    raise exception 'Die Prüfsumme darf nicht verändert werden (Aufbewahrungspflicht).';
  end if;
  if old.laufnummer is not null and new.laufnummer is distinct from old.laufnummer then
    raise exception 'Die Laufnummer darf nicht verändert werden (Aufbewahrungspflicht).';
  end if;
  if new.erstellt is distinct from old.erstellt then
    raise exception 'Der Eingangszeitpunkt darf nicht verändert werden (Aufbewahrungspflicht).';
  end if;
  if old.dateiname is not null and new.dateiname is distinct from old.dateiname then
    raise exception 'Der Dateiname darf nicht verändert werden (Aufbewahrungspflicht).';
  end if;

  -- Einmal verworfen bleibt verworfen. Sonst waere der Vermerk wertlos.
  if old.verworfen_am is not null and new.verworfen_am is null then
    raise exception 'Ein verworfener Beleg kann nicht zurückgeholt werden. Lade ihn neu hoch.';
  end if;

  return new;
end $$;

drop trigger if exists belege_schutz_update on public.belege;
create trigger belege_schutz_update before update on public.belege
  for each row execute function public.belege_schutz();

drop trigger if exists belege_schutz_delete on public.belege;
create trigger belege_schutz_delete before delete on public.belege
  for each row execute function public.belege_schutz();

-- ------------------------------------------------------------- 3) Buchungen
--
-- Der Zahltag. Er entscheidet ueber den Monatsordner, nicht das Rechnungsdatum.
alter table public.buchungen add column if not exists bezahlt_am date;

-- Bestand: was als bezahlt gilt, hat am Buchungsdatum gezahlt. Offene
-- Einnahmen bleiben ohne Zahltag — sie gehoeren in keinen Ordner.
update public.buchungen set bezahlt_am = datum
 where bezahlt_am is null and (art = 'ausgabe' or bezahlt = true);

create index if not exists buchungen_bezahlt_am_idx on public.buchungen (bezahlt_am);

-- --------------------------------------------------------- 4) Monatsexporte
--
-- Jeder erzeugte Monatsordner wird protokolliert: wer ihn wann gezogen hat,
-- welche Belege drin waren und mit welcher Pruefsumme. Damit ist spaeter
-- belegbar, was die Steuerberaterin bekommen hat.
create table if not exists public.monats_exporte (
  id           bigserial primary key,
  jahr         int         not null,
  monat        int         not null check (monat between 1 and 12),
  anzahl       int         not null default 0,
  summe_ein    numeric(12,2) not null default 0,
  summe_aus    numeric(12,2) not null default 0,
  laufnummern  bigint[]    not null default '{}',
  pruefsumme   text,
  von          uuid        references public.profiles(id),
  erstellt     timestamptz not null default now()
);

create index if not exists monats_exporte_zeit_idx on public.monats_exporte (jahr desc, monat desc);

alter table public.monats_exporte enable row level security;

drop policy if exists monats_exporte_admin on public.monats_exporte;
create policy monats_exporte_admin on public.monats_exporte
  for all using (public.ist_admin()) with check (public.ist_admin());
