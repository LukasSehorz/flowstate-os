-- =====================================================================
-- Flowstate CRM — Aufgaben und Bereiche je Person (Migration 0017)
--
-- Bisher stand auf der Teamseite nur "Geschäftsführung" oder "Mitarbeiter".
-- Damit sieht man nicht, wer eigentlich was macht — und ohne das lassen sich
-- die Zahlen einer Person nicht einordnen: Wer gar kein Cold Calling macht,
-- darf dort auch keine Quote haben.
--
-- aufgaben  = was die Person konkret tut
-- bereiche  = in welchen Sparten sie arbeitet (webdesign | performance | ki)
-- =====================================================================

alter table public.profiles add column if not exists aufgaben text[] not null default '{}';
alter table public.profiles add column if not exists bereiche text[] not null default '{}';

-- Simon: nur Webdesign, im Vertrieb unterwegs
update public.profiles set
  bereiche = array['webdesign'],
  aufgaben = array['Cold Calling', 'Erstgespräche führen']
 where name ilike 'Simon%';

-- Ioannis: alle drei Bereiche, Vertrieb und Umsetzung
update public.profiles set
  bereiche = array['webdesign', 'performance', 'ki'],
  aufgaben = array['Cold Calling', 'Erstgespräche führen', 'Webseiten bauen', 'Social Media']
 where name ilike 'Ioannis%';

-- Louis: reines Performance Marketing
update public.profiles set
  bereiche = array['performance'],
  aufgaben = array['Google Ads', 'LinkedIn Ads', 'Xing Ads', 'Website-Analyse']
 where name ilike 'Louis%';

-- Jannik und Lukas: Geschäftsführung — alles
update public.profiles set
  bereiche = array['webdesign', 'performance', 'ki'],
  aufgaben = array[
    'Cold Calling', 'Erstgespräche führen', 'Angebote erstellen', 'Vertragsabschluss',
    'Webseiten bauen', 'Website-Analyse', 'Hosting & Wartung',
    'Google Ads', 'LinkedIn Ads', 'Xing Ads', 'Meta Ads', 'Social Media',
    'KI-Readiness-Check', 'KI-Automatisierungen', 'Reporting',
    'Onboarding', 'Kundenbetreuung', 'Projektleitung',
    'Rechnungsstellung', 'Recruiting', 'Strategie & Führung']
 where name ilike 'Jannik%' or name ilike 'Lukas%';
