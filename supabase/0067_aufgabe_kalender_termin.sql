-- =====================================================================
-- Flowstate — CRM-Aufgaben im Google Kalender: aufgaben.kalender_termin
-- (Migration 0067, 08.09.2026)
--
-- Wunsch von Lukas: "Geht das, dass die CRM-To-Dos auch gleich in meinem
-- Google Kalender stehen?"
--
-- Der Weg dahin steht schon: lib/kalender-akte.js schreibt seit 0059 Termine
-- nach Google und haengt sie ueber termin_verknuepfungen an eine Kundenakte.
-- Was fehlte, ist die Kennung des Termins AN DER AUFGABE — ohne sie koennte
-- man einen Eintrag zwar anlegen, aber nie wieder finden:
--
--   Datum verschoben   -> derselbe Termin muss wandern, nicht ein zweiter
--                         entstehen (genau der Fehler, den 0051/kalender-akte
--                         beim Erstgespraech schon einmal beheben mussten)
--   Aufgabe abgehakt   -> der Termin wird abgesagt
--   Aufgabe geloescht  -> ebenso
--
--   kalender_termin  Die Google-Termin-ID (events/<id>) des EINEN Eintrags,
--                    den DIESE Aufgabe angelegt hat. Leer, solange keiner
--                    existiert (keine Firma, kein Datum, Kalender nicht
--                    angebunden, KALENDER_AUFGABEN=aus).
--
-- Warum text und OHNE Fremdschluessel — genau wie tafel_element (0058):
-- Die Termine liegen bei Google, nicht in dieser Datenbank. Es gibt nichts,
-- worauf ein Fremdschluessel zeigen koennte, und ein Termin, den jemand in
-- der Google-Oberflaeche loescht, darf die Aufgabe nicht mitreissen. Bleibt
-- eine Kennung ins Leere zeigen, faellt das beim naechsten Verschieben auf
-- ("not found") und der Code legt einen neuen Termin an, statt an einer
-- toten Kennung festzuhalten (lib/crm.js, aufgabeInKalender).
--
-- Der Termin, der zu einem gebuchten ERSTGESPRAECH gehoert, steht hier
-- bewusst NICHT: Er gehoert erstgespraechSynchronisieren() und haengt an
-- termin_verknuepfungen mit art='erstgespraech'. Die Aufgabe dazu bekommt
-- deshalb gar keinen eigenen Eintrag — sonst stuende derselbe Termin zweimal
-- im Kalender, einmal mit Uhrzeit und einmal ganztaegig.
--
-- Der Index deckt genau die eine Frage, die im Betrieb gestellt wird: "haengt
-- an diesem Termin eine Aufgabe?" (Aufraeumen, Fehlersuche). Teilindex, weil
-- die ueberwaeltigende Mehrheit der Aufgaben keinen Termin hat — er bleibt
-- damit klein, wie idx_aufgaben_anlass aus 0066.
--
-- Wiederholbar: add column if not exists, create index if not exists.
-- =====================================================================

alter table public.aufgaben add column if not exists kalender_termin text;

comment on column public.aufgaben.kalender_termin is
  'Google-Termin-ID des ganztaegigen Kalendereintrags dieser Aufgabe (lib/crm.js aufgabeInKalender, 0067). Leer = kein Eintrag. Ohne Fremdschluessel, wie tafel_element.';

create index if not exists idx_aufgaben_kalender_termin
  on public.aufgaben(kalender_termin)
  where kalender_termin is not null;
