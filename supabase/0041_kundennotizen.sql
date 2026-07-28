-- =====================================================================
-- Flowstate — freies Notizfeld in der Kundenakte (Migration 0041)
--
-- Warum (28.07.2026): Beim Anlegen des ersten echten Kunden fehlte die
-- naheliegendste Sache — ein Platz, an dem einfach steht, was man über den
-- Kunden weiß. Die Akte hatte nur Felder mit fester Bedeutung.
--
-- Es gab schon drei Textfelder, aber jedes mit eigenem Zweck:
--   anruf_notiz   was beim letzten Cold Call gesagt wurde
--   besonderes    eine Auffälligkeit für die Lead-Bewertung
--   stand         wo der Lead im Vertriebsprozess steht
-- Und der Verlauf darüber ist ein Protokoll: Einträge kommen dazu, keiner
-- wird geändert. Wer dort etwas korrigieren will, kann es nicht.
--
-- "notizen" ist das Gegenteil davon: EIN Feld, frei beschreibbar, jederzeit
-- änderbar. Alles, was keine eigene Spalte hat und trotzdem wichtig ist —
-- Absprachen, Zugänge, Vorlieben, wer wen kennt.
-- =====================================================================

alter table public.firmen add column if not exists notizen text;

comment on column public.firmen.notizen is
  'Freies Notizfeld der Kundenakte. Jederzeit änderbar — im Gegensatz zum Verlauf, der ein Protokoll ist.';
