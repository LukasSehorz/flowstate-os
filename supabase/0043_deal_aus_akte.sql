-- =====================================================================
-- Flowstate — ein Kunde IST ein gewonnener Deal (Migration 0043)
--
-- Warum (28.07.2026, Korrektur zu 0042): Ich hatte den Umsatz auf der Zentrale
-- auf die bezahlten Einnahmen umgestellt. Das war falsch herum. Die richtige
-- Trennung ist:
--
--   UMSATZ     = abgeschlossenes Geschäft. Ein Deal auf "gewonnen" zählt,
--                auch wenn der Kunde noch nicht überwiesen hat.
--   EINNAHMEN  = Geld, das tatsächlich da ist. Buchhaltung, bezahlte Buchungen.
--
-- Beides muss nebeneinander stehen können: 2.000 € Umsatz und 0 € Einnahmen
-- heißt "gewonnen, Rechnung offen" — eine wichtige Aussage, die verschwindet,
-- wenn man beide Zahlen aus derselben Quelle zieht.
--
-- Das Problem war nie die Definition, sondern eine Lücke: Kunden, die von Hand
-- angelegt wurden, hatten nie einen Deal. Sie sind durch keine Pipeline
-- gelaufen — trotzdem sind sie gewonnenes Geschäft. Ab jetzt legt die
-- Kundenakte den zugehörigen Deal an, sobald ein Preis darin steht.
--
-- Die Spalten sind dieselben wie bei buchungen in 0042, aus demselben Grund:
-- Ohne Wiedererkennung würde jedes Speichern der Akte einen weiteren Deal
-- anlegen und der Umsatz mit jedem Klick wachsen.
-- =====================================================================

alter table public.deals add column if not exists quelle             text;
alter table public.deals add column if not exists quelle_schluessel  text;

comment on column public.deals.quelle is
  'NULL = normal in der Pipeline entstanden · ''kundenakte'' = aus einer Kundenakte erzeugt (crm.js dealAusAkte).';

-- Je Firma und Position höchstens EIN erzeugter Deal. Der Index ist der Schutz
-- gegen doppelten Umsatz — nicht die Sorgfalt im Code.
create unique index if not exists deals_akte_einmalig
  on public.deals (firma_id, quelle_schluessel)
  where quelle = 'kundenakte';
