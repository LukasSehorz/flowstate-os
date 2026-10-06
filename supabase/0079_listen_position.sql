-- 0079 — Die Anrufliste steht in der Reihenfolge der Datei (06.10.2026)
--
-- Lukas: "Die Reihenfolge im CRM soll exakt der Reihenfolge der Excel
-- entsprechen. Wenn ich bei Nr. 10 telefoniere, muss im CRM an Position 10
-- derselbe Betrieb stehen."
--
-- Bis heute merkte sich das CRM nur, AUS WELCHER Liste ein Lead kam, nicht an
-- welcher Stelle er dort stand. Sortiert wurde nach Score und letzter
-- Aktivitaet — und ein Upload legt alle Zeilen in EINER Transaktion an, also
-- mit identischem Zeitstempel. Die 1.205 Leads der KI-Liste vom 06.10. hatten
-- damit alle denselben Sortierwert, und die Datenbank gab sie in beliebiger
-- Folge heraus. Die Excel ist aber absichtlich sortiert (die besten zuerst).
--
-- position = die Nummer des Leads in SEINER hochgeladenen Liste:
--   * die Spalte "Nr" der Datei, wenn es eine gibt (Luecken bleiben Luecken:
--     eine Zeile, die als Dublette uebersprungen wurde, behaelt ihre Nummer
--     nicht — die naechste behaelt aber ihre),
--   * sonst die Zeilenfolge der Datei.
-- Sie haengt an call_listen_eintraege und nicht an firmen, weil sie zur
-- Liste gehoert: dieselbe Nummer bedeutet in einer anderen Datei etwas anderes.
--
-- Altbestand bleibt NULL: Ältere Listen behalten ihre bisherige Ordnung, und
-- die Anrufliste stellt Leads ohne Position wie bisher hinten an.
--
-- Wiederholbar: "if not exists".

alter table public.call_listen_eintraege
  add column if not exists position integer;
