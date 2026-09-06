-- =====================================================================
-- Flowstate — Beleg diktieren und verschicken (Migration 0062)
--
-- Warum (Lukas, 05.09.2026): "Danach soll ich gleich die Möglichkeit haben,
-- dass eine E-Mail dafür gestellt wird oder eine WhatsApp-Nachricht, und dann
-- kann ich im nächsten Schritt die Rechnung per E-Mail oder WhatsApp
-- abschicken."
--
-- Fuer den Weg ueber E-Mail reicht 0060: das PDF haengt an, versendet_am und
-- versendet_an stehen an der Rechnung. Der Weg ueber WhatsApp braucht zwei
-- Dinge mehr, und die stehen hier.
--
-- 1) beleg_links — der Weg zum PDF fuer jemanden ohne Konto
--
--    WhatsApp kann keine Datei mitschicken (geprueft an lib/whatsapp.js: die
--    Bruecke nimmt senden({an, text}), sonst nichts). Bliebe: das PDF gar nicht
--    zu schicken und in der Nachricht auf eine Mail zu vertroesten — dann waere
--    der WhatsApp-Weg aber nur eine Ankuendigung und kein Versand.
--
--    Also ein Link. Und ein Link auf eine Rechnung ist eine heikle Sache: Der
--    Kunde hat kein Konto in diesem System und wird auch keines bekommen, also
--    ist der Link selbst die ganze Berechtigung. Deshalb:
--      · Der Schluessel ist der PRIMARY KEY und kommt aus crypto.randomBytes(24)
--        (32 Zeichen base64url, 192 Bit). Er laesst sich nicht aus der
--        Rechnungsnummer ableiten und nicht durchprobieren.
--      · Er laeuft ab. 30 Tage decken das Zahlungsziel von 14 Tagen mit Puffer
--        ab; danach ist der Link tot, auch wenn der Chatverlauf beim Kunden
--        bleibt.
--      · Es gibt kein Verzeichnis. Die Route GET /r/:schluessel liefert genau
--        ein PDF oder eine Seite "Dieser Link ist abgelaufen." — sie listet
--        nichts auf und verraet auch nicht, ob es die Rechnung gibt.
--      · on delete cascade: Wird die Rechnung geloescht, ist der Link weg. Ein
--        Link, der ins Leere zeigt, waere schlimmer als keiner.
--
-- 2) beleg_versand — was wann an wen rausging
--
--    rechnungen.versendet_am/versendet_an (0060) haelt genau EINEN Versand
--    fest, den letzten. Das reichte, solange es nur den Mailweg gab. Jetzt
--    kann derselbe Beleg per Mail UND per WhatsApp gehen, ein Gmail-Entwurf
--    dazwischenliegen und ein Versuch scheitern. Diese Tabelle ist die
--    Verlaufsliste dazu — sie ersetzt die beiden Spalten nicht, sie erklaert sie.
--
--    abgefangen = true heisst: ADS_PROBE war an, die Nachricht hat das Haus
--    NICHT verlassen (lib/probemodus.js). Solche Zeilen tragen bewusst
--    gesendet_am = NULL. Ein Testmodus, der so tut, als waere alles rausgegangen,
--    macht den Test wertlos.
--
-- Rechte: Schreiben und Lesen nur Geschaeftsfuehrung (ist_admin) — anders als
-- bei rechnungen selbst, wo Louis den Zahlstand seiner Kunden sehen darf. Ein
-- gueltiger PDF-Link ist ein Schluessel, kein Datum; er hat in keiner Akte
-- etwas zu suchen. Die Route GET /r/:schluessel liest deshalb OHNE Nutzer
-- (crm.system), nicht unter RLS.
-- =====================================================================

create table if not exists public.beleg_links (
  schluessel   text primary key,
  rechnung_id  bigint not null references public.rechnungen(id) on delete cascade,
  gueltig_bis  timestamptz not null,
  erstellt_von uuid references public.profiles(id),
  erstellt     timestamptz not null default now()
);

create index if not exists beleg_links_rechnung_idx on public.beleg_links (rechnung_id);
-- Fuer das Aufraeumen abgelaufener Links (und damit die Tabelle nicht ewig waechst).
create index if not exists beleg_links_gueltig_idx  on public.beleg_links (gueltig_bis);

comment on table public.beleg_links is
  'Signierte, zeitlich begrenzte Links auf ein Rechnungs-PDF (05.09.2026). Der Schluessel ist die ganze Berechtigung — 24 Zufallsbytes aus crypto.randomBytes, 30 Tage gueltig, abrufbar ohne Anmeldung unter GET /r/<schluessel>.';
comment on column public.beleg_links.gueltig_bis is
  'Danach liefert die Route nur noch "Dieser Link ist abgelaufen." — der Chatverlauf beim Kunden bleibt, der Zugang nicht.';

create table if not exists public.beleg_versand (
  id           bigserial primary key,
  rechnung_id  bigint not null references public.rechnungen(id) on delete cascade,
  -- mail | mail-entwurf | whatsapp
  kanal        text not null,
  an           text not null default '',
  -- NULL, wenn abgefangen (Probemodus), wenn es ein Gmail-Entwurf war oder
  -- wenn der Versuch gescheitert ist.
  gesendet_am  timestamptz,
  abgefangen   boolean not null default false,
  fehler       text,
  erstellt_von uuid references public.profiles(id),
  erstellt     timestamptz not null default now()
);

create index if not exists beleg_versand_rechnung_idx on public.beleg_versand (rechnung_id, erstellt desc);

comment on table public.beleg_versand is
  'Verlaufsliste der Sendungen zu einem Beleg (05.09.2026). rechnungen.versendet_am haelt nur den letzten Versand; hier steht jeder Versuch, auch die abgefangenen und die gescheiterten.';
comment on column public.beleg_versand.abgefangen is
  'true = ADS_PROBE war an, die Nachricht hat das Haus nicht verlassen (lib/probemodus.js). gesendet_am bleibt dann leer.';

-- ---------------------------------------------------------------------
-- Rechte
-- ---------------------------------------------------------------------
alter table public.beleg_links   enable row level security;
alter table public.beleg_versand enable row level security;

drop policy if exists beleg_links_lesen on public.beleg_links;
create policy beleg_links_lesen on public.beleg_links
  for select using (public.ist_admin());

drop policy if exists beleg_links_anlegen on public.beleg_links;
create policy beleg_links_anlegen on public.beleg_links
  for insert with check (public.ist_admin());

drop policy if exists beleg_links_loeschen on public.beleg_links;
create policy beleg_links_loeschen on public.beleg_links
  for delete using (public.ist_admin());

drop policy if exists beleg_versand_lesen on public.beleg_versand;
create policy beleg_versand_lesen on public.beleg_versand
  for select using (public.ist_admin());

drop policy if exists beleg_versand_anlegen on public.beleg_versand;
create policy beleg_versand_anlegen on public.beleg_versand
  for insert with check (public.ist_admin());
