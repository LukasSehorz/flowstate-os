-- =====================================================================
-- Flowstate — "faellig": der Termin ist da (Migration 0037)
--
-- Ablauf ab jetzt: Datei hochladen + Zeitpunkt setzen -> das Kaertchen rueckt
-- nach "Geplant" -> zum Zeitpunkt wird es faellig.
--
-- WAS AN DIESER STELLE EHRLICH GEHT UND WAS NICHT
--
-- Das System kann NICHT selbst auf TikTok, YouTube oder Instagram posten. Dafuer
-- braeuchte es je Plattform einen freigegebenen Zugang (jede prueft ihre Apps
-- einzeln, das dauert Wochen) und einen Server, der durchlaeuft — nicht einen
-- Laptop, der abends zugeklappt wird.
--
-- Was es kann, und zwar verlaesslich: den Zeitpunkt ueberwachen und im richtigen
-- Moment sagen "das hier muss JETZT raus". Darum dieser Status. Er ist keine
-- Notloesung, sondern die halbe Miete: die Frage "was muss gerade raus?" ist
-- beantwortet, nur der letzte Handgriff bleibt am Menschen.
--
-- Sobald der Plattformzugang steht, setzt derselbe Job an derselben Stelle
-- statt 'faellig' den Beitrag ab. Nichts an diesem Ablauf muss sich dann
-- aendern — nur der eine Aufruf kommt dazu.
-- =====================================================================

alter table public.content_posts drop constraint if exists content_posts_veroeff_status_check;
alter table public.content_posts add constraint content_posts_veroeff_status_check
  check (veroeff_status is null or veroeff_status in
         ('wartet', 'faellig', 'laeuft', 'fertig', 'fehler'));

comment on column public.content_posts.veroeff_status is
  'wartet = Termin liegt in der Zukunft · faellig = Zeitpunkt erreicht, muss raus · fertig/fehler = nach dem Absetzen.';

-- Damit der Waechter nicht bei jedem Lauf die ganze Tabelle liest.
create index if not exists content_posts_faellig_idx
  on public.content_posts (geplant_um)
  where veroeff_status in ('wartet', 'faellig');
