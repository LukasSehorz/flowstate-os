# Flowstate OS

## Was es ist
Das interne Betriebssystem von **svh Consulting** (Sehorz Lukas, vom Hofe Jannik GbR, 84405 Dorfen; bis September 2026 Flowstate AI Solutions). Eine einzige Weboberfläche, über die die Agentur läuft: Cold-Calling-Liste, CRM mit Vertriebs-Pipeline, Buchhaltung, Content- und Marketing-Planung, Wissensarchiv — und eine Sprachassistentin, die man anspricht statt anzuklicken.

Angeboten werden Webdesign, Performance Marketing sowie KI-Beratung und -Implementierung.

## Der Mechanismus, den nur dieses Produkt hat
Die Assistentin ist nicht in das Werkzeug eingebaut, sie **bedient** es. Wer „Hey Alexandra" sagt, spricht mit derselben Datenbank, die die Oberfläche zeigt: Sie legt Leads an, verschiebt Deals, liest Termine vor, schreibt Rechnungen. Zwei Instanzen mit getrenntem Gedächtnis — Alexandra für Lukas, Jarvis für Jannik —, aber einem gemeinsamen Firmengedächtnis.

## Wer damit arbeitet
- **Lukas Sehorz, Jannik vom Hofe** — Geschäftsführung, sehen alles, inklusive Buchhaltung.
- **Ioannis, Louis, Simon** — Vertrieb und Umsetzung. Sehen ihre eigenen Leads; die Trennung wird in der Datenbank durchgesetzt (Row-Level-Security), nicht nur in der Oberfläche.

## Die reale Nutzungsszene
Am Schreibtisch, über Stunden. Die Cold-Calling-Liste wird abtelefoniert, während die Zahlen daneben laufen. Deshalb sind die Arbeitsansichten hell und ruhig — dort wird gelesen, nicht bestaunt.

**Zwei Seiten sind die Ausnahme:** Die Sprachbühne und die Zentrale werden auf einem großen Bildschirm gezeigt und **abgefilmt für Meta-Anzeigen**. Sie haben ein zweites Publikum, das nicht bedient, sondern zusieht. Dort gilt Bühne vor Ruhe — ohne dass eine Zahl erfunden wird.

## Was unantastbar ist
- **Echte Zahlen.** Alles, was angezeigt wird, kommt aus der Datenbank. Keine Platzhalter-Umsätze, keine erfundenen Kunden — auch nicht in einer Werbeaufnahme.
- **Das Blau.** `#2563EB` im Hellen, `#4B8DF8` im Dunkeln. Farbe ist gesetzt, Form ist frei.
- **Die Rechtetrennung.** Was ein Mitarbeiter nicht sehen darf, wird nicht gebaut — auch nicht ausgegraut.
- **Deutsch.** Oberfläche, Code-Bezeichner und Kommentare.
- **Die Arbeitsansichten.** CRM, Kunden, Buchhaltung bleiben hell und unverändert.

## Technische Wirklichkeit
Node.js mit Express, serverseitig gerendert (Template-Strings, kein Frontend-Framework), PostgreSQL bei Supabase, Docker auf einem Hostinger-VPS. GSAP liegt lokal bereit. Keine Aufrufe an fremde Server aus der Oberfläche — Schriften werden selbst gehostet.

## Woran ein poliertes Ergebnis scheitern würde
Wenn die Zentrale zwar beeindruckend aussieht, aber niemand mehr sieht, was heute zu tun ist. Die anstehenden Aufgaben sind das Wichtigste auf der Seite — vor Umsatz, vor Pipeline, vor allem anderen.
