-- =====================================================================
-- Flowstate CRM — "Verloren" von den Parkplaetzen zurueckholen (0019)
--
-- Beim Einspielen am 26.07. blieb "Verloren" in allen drei Bereichen auf
-- Positionen ueber 1000 stehen:
--     ki 1110 · performance 1008 · webdesign 1007
--
-- Grund: 0015 parkt jede Pipeline hoch (position + 1000) und setzt danach die
-- Zielpositionen — aber nur fuer die Phasen, die es KENNT. "Verloren" kam erst
-- mit 0016 dazu, also eine Migration SPAETER. Wird 0015 danach (nochmal)
-- ausgefuehrt, parkt es "Verloren" mit und holt es nie zurueck.
--
-- Sichtbar war das kaum, weil eine sehr hohe Position beim Sortieren ohnehin
-- ganz hinten landet — und dort gehoert "Verloren" hin. Stehen bleiben darf es
-- trotzdem nicht: Sobald jemand eine Phase an Position 8 oder 9 ergaenzt,
-- kollidiert das mit nichts, aber niemand versteht mehr, warum eine Phase auf
-- 1110 steht. Aufgeraeumte Zahlen sind der halbe Grund, warum man Migrationen
-- ueberhaupt schreibt.
--
-- Setzt "Verloren" je Bereich direkt hinter die letzte echte Phase. Mehrfach
-- ausfuehrbar: Beim zweiten Lauf steht es schon richtig, dann passiert nichts.
-- =====================================================================

update public.pipeline_stages v
   set position = (
     select coalesce(max(x.position), 0) + 1
       from public.pipeline_stages x
      where x.sparte = v.sparte and x.art = v.art
        and x.position < 50            -- die geparkten nicht mitzaehlen
        and x.name <> 'Verloren'
   )
 where v.name = 'Verloren'
   and v.position >= 50;
