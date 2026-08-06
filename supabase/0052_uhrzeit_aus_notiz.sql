-- =====================================================================
-- Flowstate — Uhrzeiten aus den Gesprächsnotizen zurückholen (Migration 0052)
--
-- Nach 0051 kann das Terminfeld eine Uhrzeit tragen. Die 18 bestehenden
-- Termine stehen aber auf Mitternacht, weil das Feld frueher nur ein Datum
-- war. Die Uhrzeit ist nicht verloren — sie steht in der Gesprächsnotiz, weil
-- der Buchungsdialog sie dort ablegte ("Termin 2026-08-12T14:00 · …").
--
-- Diese Migration holt sie zurück, aber nur mit Beweis:
--
--   Die Notiz wird NUR uebernommen, wenn ihr Datum mit dem Terminfeld
--   uebereinstimmt.
--
-- Gemessen am 06.08.: 13 Termine tragen eine Uhrzeit in der Notiz, bei 11
-- stimmt der Tag. Bei zweien nicht — dort wurde spaeter verschoben, das
-- Terminfeld nachgezogen und die alte Notiz stehen gelassen. Die Notiz ist
-- dann veraltet und das Feld die Wahrheit; wer sie trotzdem uebernaehme,
-- setzte Termine auf einen Tag zurueck, der vorbei ist.
--
-- Angefasst wird ausserdem nur, was auf Mitternacht steht: Eine bereits von
-- Hand eingetragene Uhrzeit ist die juengere Angabe und bleibt.
--
-- Wiederholbar: Nach dem Lauf steht dort keine Mitternacht mehr, die Bedingung
-- greift also kein zweites Mal.
-- =====================================================================

update public.firmen f
   set erstgespraech_am = (
         (regexp_match(f.anruf_notiz, 'Termin (\d{4}-\d{2}-\d{2}T\d{2}:\d{2})'))[1]
       )::timestamp at time zone 'Europe/Berlin'
 where f.erstgespraech_am is not null
   -- nur Termine ohne Uhrzeit
   and (f.erstgespraech_am at time zone 'Europe/Berlin')::time = '00:00'
   and f.anruf_notiz ~ 'Termin \d{4}-\d{2}-\d{2}T\d{2}:\d{2}'
   -- und nur, wenn die Notiz denselben Tag meint
   and substring((regexp_match(f.anruf_notiz, 'Termin (\d{4}-\d{2}-\d{2})T\d{2}:\d{2}'))[1] from 1 for 10)
       = to_char(f.erstgespraech_am at time zone 'Europe/Berlin', 'YYYY-MM-DD');
