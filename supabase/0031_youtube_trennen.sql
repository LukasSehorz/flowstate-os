-- =====================================================================
-- Flowstate — YouTube Video und YouTube Shorts trennen (Migration 0031)
--
-- Beides laeuft auf demselben Kanal, ist aber verschiedene Arbeit und hat
-- verschiedene Ziele: 1 langes Video pro Woche, 14 Shorts. In einem Topf
-- gerechnet saehe eine Woche mit 15 Shorts und ohne Langvideo aus wie eine
-- erfuellte Woche — obwohl genau das Stueck fehlt, das am meisten Aufwand macht.
--
-- Die Shorts sind ausserdem DIESELBEN Videos wie auf TikTok und Instagram, das
-- Langvideo ist ein eigenes Stueck. Auch darum gehoeren sie auseinander.
--
-- Aus einem Kanal "YouTube" werden also zwei:
--   YouTube Video    Ziel 1
--   YouTube Shorts   Ziel 14
-- =====================================================================

-- Bestand: bisher gab es nur "YouTube". Wo es steht, sind es Shorts — das
-- Langvideo gab es zum Zeitpunkt dieser Migration noch nicht.
update public.content_posts
   set kanaele = array_replace(kanaele, 'YouTube', 'YouTube Shorts')
 where 'YouTube' = any(kanaele);

-- Ziele umschreiben: aus einem YouTube-Ziel werden zwei.
insert into public.content_ziele (marke, kanal, ziel)
select marke, 'YouTube Video', 1 from public.content_ziele where kanal = 'YouTube'
on conflict (marke, kanal) do nothing;

insert into public.content_ziele (marke, kanal, ziel)
select marke, 'YouTube Shorts', 14 from public.content_ziele where kanal = 'YouTube'
on conflict (marke, kanal) do nothing;

delete from public.content_ziele where kanal = 'YouTube';
