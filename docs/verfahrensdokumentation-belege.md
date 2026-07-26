# Verfahrensdokumentation — Belegablage und Buchführung

**Sehorz & vom Hofe GbR** · Kleinunternehmer nach §19 UStG
Stand: 26. Juli 2026 · System: Flowstate Operating System, Modul „Buchhaltung"

---

## Wozu dieses Dokument

Wer Belege digital aufbewahrt, muss erklären können, wie das System arbeitet — das
verlangen die GoBD, unabhängig davon, welche Software eingesetzt wird. Ein
Prüfer will nicht die Belege allein sehen, sondern nachvollziehen können, auf
welchem Weg sie ins System kommen, was mit ihnen passiert und warum sie
unterwegs nicht verändert werden können.

Genau das steht hier. Das Dokument gehört zu den aufbewahrungspflichtigen
Unterlagen und wird bei jeder Änderung am Verfahren fortgeschrieben (siehe
Änderungsstand am Ende).

> **Hinweis:** Dieses Dokument beschreibt das eingesetzte Verfahren. Es ersetzt
> keine steuerliche Beratung. Ob das Verfahren den Anforderungen im Einzelfall
> genügt, beurteilt die Steuerberaterin.

---

## 1. Überblick

Belege entstehen im Tagesgeschäft als Papierquittung, PDF-Rechnung oder E-Mail-
Anhang. Sie werden im Flowstate Operating System erfasst, geprüft, gebucht und
dort dauerhaft aufbewahrt. Am Monatsende wird ein Monatsordner erzeugt und der
Steuerberaterin übergeben, die daraus die Buchführung erstellt.

Ein separates Buchhaltungsprogramm wird nicht eingesetzt.

**Beteiligte Systeme**

| System | Rolle |
|---|---|
| Flowstate Operating System (Eigenentwicklung, Node.js) | Erfassung, Prüfung, Buchung, Archiv, Monatsexport |
| Supabase / PostgreSQL (Rechenzentrum Frankfurt, EU) | Datenhaltung inklusive Belegdateien |
| Steuerkanzlei | Erstellt aus den Monatsordnern die Buchführung |

---

## 2. Der Ablauf im Einzelnen

### 2.1 Eingang

Belege werden über die Seite **Buchhaltung** hochgeladen, getrennt nach
Richtung:

- **Ausgaben** — Quittungen, Tankbelege, Eingangsrechnungen
- **Einnahmen** — unsere Rechnungen an Kunden

Zugelassene Formate: PDF, JPG, PNG, WEBP, GIF. Höchstgröße 20 MB je Datei.
Papierbelege werden abfotografiert oder gescannt; das Papieroriginal ist danach
nicht mehr aufbewahrungspflichtig, sofern die Wiedergabe bildlich und inhaltlich
mit dem Original übereinstimmt.

**Verkleinerung großer Fotos.** Fotos über 3,4 MB werden vor dem Hochladen im
Browser auf 2.400 Pixel an der längsten Kante verkleinert und als JPEG mit
Qualitätsstufe 0,9 gespeichert. Archiviert wird diese verkleinerte Fassung; sie
ist damit nicht byteidentisch mit der Kameradatei.

Der Grund ist praktischer Natur: Handyfotos sind häufig 4 bis 8 MB groß und
lassen sich in dieser Größe maschinell nicht mehr auslesen. Ohne die
Verkleinerung müssten alle Werte von Hand erfasst werden.

Zur Wiedergabetreue: Eine Quittung ist typischerweise 8 cm breit. 2.400 Pixel
auf dieser Breite entsprechen über 700 dpi und liegen damit weit über dem, was
für eine bildliche Übereinstimmung mit dem Original erforderlich ist — übliche
Belegscans arbeiten mit 200 bis 300 dpi. Inhalt, Anordnung und Lesbarkeit
bleiben unverändert.

PDFs und Bilder unter 3,4 MB werden **unverändert** übernommen.

**Beim Eingang geschieht automatisch und ohne Zutun des Benutzers:**

1. Die Datei wird **unverändert** in der Datenbank abgelegt (Spalte `belege.daten`).
   Es findet keine Umwandlung, Komprimierung oder Nachbearbeitung statt.
2. Es wird eine **fortlaufende Laufnummer** aus einer Datenbanksequenz vergeben
   (`beleg_laufnummer_seq`). Die Nummerierung ist lückenlos und nicht
   beeinflussbar.
3. Es wird eine **Prüfsumme** über den Dateiinhalt gebildet (SHA-256) und
   gespeichert.
4. Der **Eingangszeitpunkt** wird gesetzt (`erstellt`).
5. Es wird geprüft, ob dieselbe Datei bereits vorliegt (Vergleich der
   Prüfsumme). Ist das der Fall, wird sie **nicht erneut** abgelegt; der
   Benutzer erhält einen Hinweis. Damit kann derselbe Beleg nicht versehentlich
   doppelt in die Buchführung gelangen.

### 2.2 Maschinelles Vorausfüllen

Nach dem Eingang wird der Beleg maschinell gelesen (Sprachmodell mit
Bilderkennung, Anthropic Claude). Ermittelt werden: Bruttobetrag, Belegdatum,
Lieferant bzw. Kunde, Kategorie, Belegnummer, ausgewiesener Steuersatz.

**Diese Werte sind ausdrücklich nur ein Vorschlag.** Sie werden dem Benutzer in
der Prüfmaske angezeigt und müssen von ihm bestätigt werden. Konnte ein Wert
nicht sicher gelesen werden, bleibt das Feld leer und es erscheint ein Hinweis,
worauf zu achten ist. Es wird nichts geraten.

Steht kein Lesedienst zur Verfügung, bleiben die Felder leer und werden von Hand
ausgefüllt. Der übrige Ablauf ist davon unberührt.

### 2.3 Prüfung und Buchung

Der Benutzer liest die Werte gegen den angezeigten Beleg gegen, korrigiert sie
bei Bedarf und bestätigt mit **„Passt"**. Erst damit entsteht eine Buchung.

Die beiden Richtungen werden unterschiedlich behandelt:

| | Ausgabe | Einnahme |
|---|---|---|
| Gilt als bezahlt | sofort — der Beleg ist der Zahlungsnachweis | nein |
| Zahltag (`bezahlt_am`) | = Belegdatum | leer, bis der Kunde zahlt |
| Zählt in den Summen | sofort | erst nach dem Zahlungseingang |
| Erscheint zunächst unter | Ausgaben | Offene Rechnungen |

Geht das Geld ein, wird die Rechnung unter **Offene Rechnungen** abgehakt.
Erst dadurch wird der Zahltag gesetzt und die Rechnung wird zur Einnahme.

Das entspricht dem **Zufluss-Prinzip** der Einnahmen-Überschuss-Rechnung:
maßgeblich ist der Tag der Zahlung, nicht der Tag der Rechnungsstellung. Eine im
Juli geschriebene und im September bezahlte Rechnung ist eine September-Einnahme.

### 2.4 Korrekturen

Betrag, Datum, Lieferant, Kategorie, Belegnummer und Notiz können jederzeit
korrigiert werden — ohne diese Möglichkeit ließe sich ein Tippfehler nie
richtigstellen. Die Belegdatei selbst, ihre Prüfsumme, die Laufnummer, der
Dateiname und der Eingangszeitpunkt können **nicht** verändert werden (siehe
Abschnitt 3).

### 2.5 Verwerfen statt Löschen

Fehlscans, versehentlich hochgeladene private Fotos oder Doppel werden
**verworfen**, nicht gelöscht. Dazu ist zwingend ein Grund anzugeben. Der Beleg

- behält seine Laufnummer (es entsteht keine Lücke),
- behält seine Datei und seine Prüfsumme,
- erhält Zeitstempel, Benutzer und Grund des Verwerfens,
- zählt in keiner Summe und in keinem Monatsordner mehr mit,
- kann nicht zurückgeholt werden.

Ein bereits gebuchter Beleg kann nicht verworfen werden. Dazu muss erst die
Buchung zurückgenommen werden — ein eigener, bewusster Schritt.

---

## 3. Unveränderbarkeit

Die Unveränderbarkeit ist **in der Datenbank** verankert, nicht im
Anwendungsprogramm. Zwei Trigger auf der Tabelle `belege` (Funktion
`public.belege_schutz()`, Migrationen `0024` und `0025`) prüfen jede Änderung.
Der Grund für diese Ebene: ein Trigger greift auch dann, wenn jemand die
Anwendung umgeht und direkt per SQL auf die Tabelle zugreift.

**Technisch unterbunden ist:**

| Vorgang | Verhalten |
|---|---|
| Beleg löschen (`DELETE`) | wird mit Fehlermeldung abgewiesen — ausnahmslos |
| Belegdatei leeren | abgewiesen |
| Belegdatei durch eine andere ersetzen | abgewiesen |
| Prüfsumme ändern oder entfernen | abgewiesen |
| Datei ohne Prüfsumme einsetzen | abgewiesen |
| Prüfsumme ohne zugehörige Datei setzen | abgewiesen |
| Laufnummer ändern | abgewiesen |
| Eingangszeitpunkt ändern | abgewiesen |
| Dateiname ändern | abgewiesen |
| Verwerfen rückgängig machen | abgewiesen |

**Ausdrücklich erlaubt ist genau ein Übergang:** eine fehlende Datei darf einmalig
nachgereicht werden, und nur zusammen mit ihrer Prüfsumme. Das betrifft
Altbelege aus der Zeit vor Einführung dieses Archivs, deren Datei damals in einem
Fremdsystem lag. Sobald eine Datei vorhanden ist, ist sie gesperrt.

Diese Regeln wurden am 26.07.2026 einzeln überprüft; jeder der oben genannten
Vorgänge wurde tatsächlich abgewiesen.

**Zugriffsbeschränkung:** Die Tabellen `belege`, `buchungen`,
`finanz_einstellungen` und `monats_exporte` unterliegen einer
Zugriffsbeschränkung auf Datenbankebene (Row Level Security). Zugriff hat
ausschließlich, wer in `profiles` die Rolle `admin` trägt — derzeit die beiden
Gesellschafter.

---

## 4. Monatsordner

Am Monatsende wird über **Buchhaltung → Monatsordner → „Ordner holen"** ein
ZIP-Archiv erzeugt und der Steuerberaterin übergeben. Es enthält:

| Datei | Inhalt |
|---|---|
| `Uebersicht.csv` | Alle Bewegungen des Monats als Tabelle (Semikolon-getrennt, UTF-8 mit BOM, in Excel direkt lesbar) |
| `Uebersicht.html` | Dieselbe Aufstellung zum Ansehen und Ausdrucken |
| `Pruefsummen.txt` | SHA-256 je Belegdatei, dazu eine Prüfsumme über den gesamten Export |
| `Belege/` | Die Belegdateien, benannt nach `Laufnummer_Zahltag_Originalname` |

Jede Zeile der Übersicht führt über die Beleg-Nummer eindeutig zu ihrer Datei im
Unterordner.

**Zuordnung zum Monat:** maßgeblich ist der **Zahltag**, nicht das Belegdatum.
Unbezahlte Rechnungen sind in keinem Monatsordner enthalten — es ist noch kein
Geld geflossen. Sie erscheinen in dem Monat, in dem sie bezahlt werden.

**Protokollierung:** Jeder Export wird in der Tabelle `monats_exporte`
festgehalten: Zeitpunkt, Benutzer, Anzahl der Bewegungen, Summen und die Liste
der enthaltenen Laufnummern samt Export-Prüfsumme. Damit ist später belegbar,
was zu welchem Zeitpunkt übergeben wurde.

Die Export-Prüfsumme wird über die sortierte Liste aus Laufnummer und
Dateiprüfsumme gebildet — nicht über die ZIP-Datei selbst. Dadurch ergibt
derselbe Monat immer denselben Wert, unabhängig davon, wann der Ordner gezogen
wurde.

---

## 5. Kontostand

Es besteht keine automatische Verbindung zum Bankkonto. Der Kontostand wird
wöchentlich aus dem Online-Banking abgelesen und mit Stichtag eingetragen. Die
Übersicht rechnet ab diesem Stichtag die erfassten Buchungen fort:

    Kontostand = eingetragener Stand + bezahlte Einnahmen − Ausgaben (ab Stichtag)

Ist der eingetragene Stand älter als sieben Tage, erscheint ein Hinweis und es
wird automatisch eine Aufgabe für den kommenden Montag angelegt.

Der Kontostand dient der eigenen Übersicht. Er ist keine Buchführungsgröße und
geht nicht in den Monatsordner ein.

---

## 6. Aufbewahrung, Sicherung, Auskunft

**Aufbewahrungsfrist:** Buchungsbelege werden mindestens acht Jahre aufbewahrt,
gerechnet ab dem Ende des Kalenderjahres, in dem der Beleg entstanden ist. Es
findet **keine automatische Löschung** statt. Ein Aufräumen nach Fristablauf
wäre eine bewusste, gesondert zu dokumentierende Handlung.

**Datensicherung:** Die Datenbank liegt bei Supabase (PostgreSQL, Rechenzentrum
in der EU) mit täglicher automatischer Sicherung durch den Anbieter.

> **Offener Punkt:** Eine zusätzliche, vom Anbieter unabhängige Sicherung der
> Belegdateien ist vorgesehen, aber noch nicht eingerichtet. Bis dahin hängt die
> Wiederherstellbarkeit allein an den Sicherungen des Anbieters.

**Maschinelle Auswertbarkeit:** Die Übersicht liegt als CSV vor und ist damit
maschinell einlesbar. Ein DATEV-Export besteht derzeit nicht; ob er benötigt
wird, ist mit der Steuerkanzlei abzustimmen.

**Auskunftsfähigkeit im Prüfungsfall:** Sämtliche Belege eines Zeitraums lassen
sich jederzeit über die Monatsordner-Funktion bereitstellen, auch rückwirkend.

---

## 7. Änderungsstand

| Datum | Änderung |
|---|---|
| 26.07.2026 | Erstfassung. Umstellung von Lexware Office auf eigene Ablage. Belegarchiv mit Laufnummer, Prüfsumme und Unveränderbarkeit eingeführt (Migrationen 0024, 0025). Monatsordner-Export eingeführt. Maschinelles Vorausfüllen der Belegwerte eingeführt. |
| 26.07.2026 | **Inbetriebnahme, Nullstellung des Archivs** — siehe Abschnitt 8. |

---

## 8. Nullstellung bei Inbetriebnahme (26.07.2026)

Vor der Inbetriebnahme enthielt das System ausschließlich Testdaten aus der
Entwicklung: 86 zu Vorführzwecken erzeugte Buchungen, 11 Belege aus Probeläufen
sowie 4 Testexporte. Ein produktiver Beleg war zu keinem Zeitpunkt erfasst.

Diese Daten wurden am 26.07.2026 vollständig entfernt und die Belegnummerierung
auf 1 zurückgesetzt. **Die laufende Nummerierung des Archivs beginnt damit am
26.07.2026 bei Nummer 1.** Vor diesem Datum existiert in diesem System keine
Buchführung; für frühere Zeiträume ist Lexware Office maßgeblich.

Der Zeitpunkt war bewusst gewählt: Solange ausschließlich Testdaten vorlagen,
war eine Nullstellung folgenlos. Nach Erfassung des ersten echten Belegs wäre
sie nicht mehr zulässig gewesen, weil sie die Lückenlosigkeit der Nummerierung
zerstört hätte.

**Durchführung:** Die Löschsperre auf der Tabelle `belege` wurde für diesen einen
Vorgang innerhalb einer einzelnen Datenbanktransaktion deaktiviert und in
derselben Transaktion wieder aktiviert. Ein Abbruch hätte den Schutz also nicht
ungesichert zurückgelassen. Die Wirksamkeit der Sperre wurde unmittelbar danach
erneut überprüft.

Betroffen waren ausschließlich die Tabellen `buchungen`, `belege` und
`monats_exporte`. Die übrigen Daten des Systems (Kunden, Projekte, Aufgaben)
blieben unberührt.

Ein vergleichbarer Eingriff ist im laufenden Betrieb nicht vorgesehen. Sollte er
je erforderlich werden, ist er hier zu dokumentieren.

**Vor der Umstellung:** Belege wurden bis zum 26.07.2026 zusätzlich an Lexware
Office übertragen. Die dort abgelegten Belege bleiben dort erhalten und sind
Bestandteil der Aufbewahrung für den betroffenen Zeitraum.
