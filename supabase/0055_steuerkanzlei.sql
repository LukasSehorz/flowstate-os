-- =====================================================================
-- Flowstate — Die Steuerkanzlei bekommt einen festen Platz (Migration 0055)
--
-- Anlass (20.08.2026): Alexandra kann den Monatsordner mit den Rechnungen
-- an die Steuerberaterin schicken. Nur wusste niemand, an WEN — die Adresse
-- stand nirgends: nicht im Kontaktbuch, nicht in der Buchhaltung, nicht in
-- der Umgebung. Sie hat dann im Gespraech danach gefragt, was jedes Mal
-- dieselbe Rueckfrage bedeutet.
--
-- Warum in finanz_einstellungen und nicht ins CRM: Im CRM stehen Kunden und
-- Leads. Dort liegen auch Steuerkanzleien — als angerufene Betriebe. Eine
-- Suche nach "Steuerberater" haette mit einiger Wahrscheinlichkeit ein
-- fremdes Buero getroffen und ihm unsere Belege geschickt. Die eigene
-- Kanzlei ist keine Firma im Vertrieb, sondern eine Einstellung des Hauses.
--
-- Anrede getrennt vom Namen, weil Alexandra den Satz spricht: "Soll ich sie
-- an Frau Meier schicken?" Ohne getrennte Anrede kaeme "an Meier" heraus,
-- und ein "Frau" davorzusetzen waere geraten — bei einem Herrn Meier waere
-- es peinlich.
-- =====================================================================

alter table public.finanz_einstellungen
  add column if not exists steuer_anrede text,      -- "Frau" | "Herr" | leer
  add column if not exists steuer_name   text,      -- "Meier" oder "Kanzlei Meier & Partner"
  add column if not exists steuer_mail   text,
  add column if not exists steuer_notiz  text;      -- Kanzlei, Anschrift, Mandantennummer

comment on column public.finanz_einstellungen.steuer_mail is
  'Empfaenger des Monatsordners. Wird von lib/steuer-versand.js gelesen; ist sie leer, fragt Alexandra im Gespraech danach, statt zu raten.';
