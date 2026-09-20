// Beleg im Gespräch — ein Faden, ein Beleg (05.09.2026).
//
// Warum (Lukas, wörtlich sinngemäß): "Bei Rechnungen und Angeboten soll man das
// nur per Chat erstellen können — nicht die ganzen einzelnen Kategorien, die
// auf der Rechnung draufkommen. Ich sage 'Kunde XYZ braucht eine Rechnung für
// eine Website in Höhe von 750 €, erstelle das im bekannten Format', und dann
// wird die Rechnung erstellt und im System abgelegt. Wenn ich später etwas an
// der Rechnung ändern will, soll die BESTEHENDE Rechnung genommen, angepasst
// und wieder abgelegt werden."
//
// Der Unterschied zu lib/beleg-diktat.js (Bereich E) ist genau dieser letzte
// Satz. Das Diktat kann EINEN Text in EINEN Entwurf verwandeln und ist danach
// fertig. Hier bleibt der Faden am Beleg hängen: "Mach 900 daraus", "Setz das
// Datum auf den 1.", "Schreib noch eine Position Hosting 120 € dazu" — jedes
// Mal wird derselbe Beleg geändert.
//
// DIE EINE REGEL, AN DER ALLES HÄNGT: In einem Gespräch gibt es GENAU EINEN
// Beleg. Sie steht nicht nur in der Systemanweisung (dort kann sie überlesen
// werden), sondern im Code: beleg_anlegen wird abgelehnt, sobald der Faden
// schon einen Beleg trägt. Der Grund ist der Schaden, den das Gegenteil macht
// — vier Entwürfe derselben Rechnung, von denen drei niemand mehr zuordnen
// kann, und im schlechten Fall zwei davon beim Kunden. Einen zweiten Beleg
// gibt es über "Neuer Beleg" in der Kopfzeile, also über einen bewussten
// Klick, nicht über einen missverstandenen Satz.
//
// GELD UND DATUM ENTSCHEIDET DAS MODELL NIE ALLEIN. Was aus dem Modell kommt,
// geht durch dieselbe Nachprüfungsebene wie im Diktat (beleg-diktat.saeubern
// für neue Belege, aenderungSaeubern für Änderungen): Beträge > 0 und
// ≤ 9.999.999,99, Datum plausibel, Vorlage aus der Liste, Positionen mit Titel
// UND Preis. Was nicht durchkommt, wird NICHT geschrieben — es wird im Chat
// benannt, damit Lukas den Satz noch einmal sagen kann. Eine stillschweigend
// zurechtgebogene Zahl nimmt ihm die Chance, den Fehler zu sehen.
//
// WARUM DER VERLAUF ALS TEXT AN DAS MODELL GEHT (und nicht als messages-Liste):
// schnell.mitWerkzeugen() schickt genau eine Nutzer-Äußerung und gibt die
// Werkzeugaufrufe zurück; eine Liste aus Assistenten- und tool_result-Blöcken
// kennt es nicht. Statt die geteilte Datei umzubauen (sie hängt an Alexandra,
// am Sprachweg und am Diktat), wird der ganze Stand in EINE Äußerung
// geschrieben: aktueller Beleg, bisheriges Gespräch, neue Nachricht, und ab
// Runde 2 die eigenen Werkzeugaufrufe samt Ergebnis. Das Modell sieht dasselbe
// wie in einem echten Mehrfachzug, und die Systemanweisung bleibt Zeichen für
// Zeichen gleich — sie liegt damit im Zwischenspeicher (siehe schnell.js).
//
// OHNE MODELLZUGANG (lokal, ohne SCHNELL_API_KEY): Nichts scheitert hart. Die
// erste Nachricht legt einen leeren Entwurf mit dem Text als Notiz an (wie im
// Diktat), jede weitere wird als Notiz an das Gespräch gehängt, und die
// Antwort sagt in einem ruhigen Satz, was los ist.

const schnell = require("./schnell.js");
const rg = require("./rechnungen.js");
const crm = require("./crm.js");
const bd = require("./beleg-diktat.js");

// Dasselbe Modell wie im Diktat: Aus "mach 900 daraus" die richtige Position
// zu treffen, ist eine Verstehensaufgabe. Eigene Variable, damit sich der
// Gesprächsweg getrennt vom Diktat umstellen lässt.
const MODELL = process.env.CHAT_MODELL || bd.MODELL;

// Wie viel Text eine Äußerung tragen darf. Alles darüber ist kein Zuruf mehr.
const MAX_TEXT = 4000;

// Wie viele Nachrichten das Modell zu sehen bekommt. Der Verlauf auf der Seite
// bleibt vollständig — nur der Aufruf wird beschnitten, sonst wächst er mit
// jeder Runde und wird langsam und teuer.
const MAX_VERLAUF = 20;

// Höchstens sechs Runden Werkzeuge je Äußerung. Eine übliche Änderung braucht
// eine (beleg_aendern), ein neuer Beleg zwei (kunde_suchen, beleg_anlegen).
// Sechs ist der Puffer für eine Rückfrage in der Mitte; danach ist es keine
// Arbeit mehr, sondern eine Schleife, und Lukas wartet auf nichts.
const MAX_RUNDEN = 6;

const s = (x, max) => String(x ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const mehrzeilig = (x, max) => String(x ?? "").replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").trim().slice(0, max);
const zahl = (x) => (/^\d+$/.test(String(x ?? "").trim()) ? Number(String(x).trim()) : null);
const jetzt = () => new Date().toISOString();

function bereit() { return bd.bereit(); }

// ===================================================================== Werkzeuge
//
// Vier Stück, mehr nicht. Jedes weitere Werkzeug ist eine weitere Möglichkeit,
// das falsche zu wählen — und alles, was hier fehlt (stellen, senden,
// stornieren), ist eine Handlung mit Folgen außerhalb des Hauses. Die bleibt
// an einem Knopf, den ein Mensch drückt.
const WERKZEUGE = [
  {
    name: "kunde_suchen",
    description: "Sucht einen Kunden im CRM. Immer VOR beleg_anlegen aufrufen, wenn ein Kundenname genannt wurde — nur so kommen Adresse und Mailadresse auf den Beleg. Bei mehreren Treffern nicht raten, sondern zurückfragen.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Der Name, wie ihn der Nutzer genannt hat. Auch ein Teil des Namens genügt." },
      },
      required: ["name"],
    },
  },
  {
    name: "beleg_zeigen",
    description: "Gibt den aktuellen Stand des Belegs in diesem Gespräch als Text zurück — mit Positionsnummern. Aufrufen, bevor du eine einzelne Position änderst oder entfernst, damit du die richtige Nummer nimmst.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "beleg_anlegen",
    description: "Legt den Beleg dieses Gesprächs als Entwurf an (noch ohne Nummer, jederzeit änderbar). Nur EINMAL je Gespräch — gibt es schon einen Beleg, nimm beleg_aendern.",
    input_schema: {
      type: "object",
      properties: {
        art: { type: "string", enum: ["angebot", "rechnung"], description: "angebot oder rechnung." },
        firma_id: { anyOf: [{ type: "number" }, { type: "null" }], description: "Die Nummer aus kunde_suchen. null, wenn der Kunde nicht im CRM steht." },
        empfaenger: {
          type: "object",
          description: "Nur ausfüllen, was NICHT aus dem CRM kommt. Mit firma_id werden Adresse und Mailadresse aus der Akte genommen.",
          properties: {
            name: { type: "string", description: "Firmenname des Empfängers." },
            ansprechperson: { type: "string", description: "Vor- und Nachname." },
            anrede: { type: "string", enum: ["Herr", "Frau", ""], description: "Nur wenn eindeutig." },
            strasse: { type: "string" },
            plz_ort: { type: "string" },
            email: { type: "string" },
          },
          required: [],
        },
        titel: { type: "string", description: "Kurzbezeichnung in ein bis drei Wörtern, z. B. 'Webseite'. Kein Satz." },
        vorlage: { type: "string", enum: bd.VORLAGEN, description: "website = Webseite/Onlineauftritt · ki = KI-Anwendung, Assistent, Automatisierung · performance = Anzeigen, Kampagnen · frei = alles andere." },
        datum: { type: "string", description: "Belegdatum als JJJJ-MM-TT. Ohne Angabe das heutige Datum." },
        faellig_tage: { type: "number", description: "Zahlungsziel in Tagen (Rechnung, üblich 14) bzw. Gültigkeit (Angebot, üblich 30)." },
        positionen: {
          type: "array",
          description: "Die Leistungszeilen. Mindestens eine mit Titel UND Preis, sonst wird nichts angelegt.",
          items: {
            type: "object",
            properties: {
              titel: { type: "string", description: "Kurzer Zeilentitel, z. B. 'Erstellung der neuen Webseite'." },
              beschreibung: { type: "string", description: "Ein bis zwei Sätze im Stil des Hauses. Leer lassen, wenn nichts Konkretes gesagt wurde." },
              menge: { type: "number", description: "Ohne Angabe 1." },
              einheit: { type: "string", enum: rg.EINHEITEN, description: "Ohne Angabe pauschal." },
              einzelpreis: { type: "number", description: "Preis je Einheit in Euro als Zahl (2500 für '2.500 €')." },
            },
            required: ["titel", "beschreibung", "menge", "einheit", "einzelpreis"],
          },
        },
        einleitung: { type: "string", description: "Nur beim Angebot: ein Satz, der mit Doppelpunkt endet. Bei der Rechnung leer lassen." },
        nutzen: { type: "array", items: { type: "string" }, description: "Nur beim Angebot: 4 bis 5 Nutzenpunkte, je ein Satz ohne Schlusspunkt. Bei der Rechnung leere Liste." },
        schluss: { type: "string", description: "Nur beim Angebot: der Schlussabsatz. Bei der Rechnung leer lassen." },
      },
      required: ["art", "titel", "vorlage", "positionen"],
    },
  },
  {
    name: "beleg_aendern",
    description: "Ändert den bestehenden Beleg dieses Gesprächs und legt ihn neu ab. Gib NUR die Felder an, die sich ändern — alles andere bleibt stehen. Für Positionen entweder positionen (ersetzt alle) ODER position_hinzu / position_weg / position_aendern.",
    input_schema: {
      type: "object",
      properties: {
        art: { type: "string", enum: ["angebot", "rechnung"], description: "Nur angeben, wenn aus der Rechnung ein Angebot werden soll oder umgekehrt." },
        firma_id: { anyOf: [{ type: "number" }, { type: "null" }], description: "Anderer Kunde — die Nummer aus kunde_suchen." },
        empfaenger: {
          type: "object",
          description: "Nur die Felder, die sich ändern.",
          properties: {
            name: { type: "string" }, ansprechperson: { type: "string" },
            anrede: { type: "string", enum: ["Herr", "Frau", ""] },
            strasse: { type: "string" }, plz_ort: { type: "string" }, email: { type: "string" },
          },
          required: [],
        },
        titel: { type: "string", description: "Neue Kurzbezeichnung." },
        vorlage: { type: "string", enum: bd.VORLAGEN },
        datum: { type: "string", description: "Neues Belegdatum als JJJJ-MM-TT." },
        faellig: { type: "string", description: "Neuer Fälligkeitstag als JJJJ-MM-TT." },
        faellig_tage: { type: "number", description: "Zahlungsziel in Tagen ab Belegdatum — Alternative zu faellig." },
        positionen: {
          type: "array",
          description: "ERSETZT alle Positionen. Nur nehmen, wenn der Beleg komplett anders aussehen soll.",
          items: {
            type: "object",
            properties: {
              titel: { type: "string" }, beschreibung: { type: "string" },
              menge: { type: "number" }, einheit: { type: "string", enum: rg.EINHEITEN },
              einzelpreis: { type: "number" },
            },
            required: ["titel", "beschreibung", "menge", "einheit", "einzelpreis"],
          },
        },
        position_hinzu: {
          type: "object",
          description: "Eine zusätzliche Zeile am Ende.",
          properties: {
            titel: { type: "string" }, beschreibung: { type: "string" },
            menge: { type: "number" }, einheit: { type: "string", enum: rg.EINHEITEN },
            einzelpreis: { type: "number" },
          },
          required: ["titel", "einzelpreis"],
        },
        position_weg: { type: "number", description: "Nummer der Zeile, die verschwindet (1 = die erste, wie in beleg_zeigen)." },
        position_aendern: {
          type: "object",
          description: "Eine bestehende Zeile ändern. nr ist Pflicht, alles andere nur, was sich ändert.",
          properties: {
            nr: { type: "number", description: "Nummer der Zeile aus beleg_zeigen (1 = die erste)." },
            titel: { type: "string" }, beschreibung: { type: "string" },
            menge: { type: "number" }, einheit: { type: "string", enum: rg.EINHEITEN },
            einzelpreis: { type: "number" },
          },
          required: ["nr"],
        },
        einleitung: { type: "string" },
        nutzen: { type: "array", items: { type: "string" }, description: "Nur beim Angebot. Ersetzt die bisherigen Punkte." },
        schluss: { type: "string" },
      },
      required: [],
    },
  },
];

// ================================================================ Systemanweisung
//
// Zwei echte Belege aus Lukas' Ordner, gekürzt (scratchpad/vorbilder/
// rechnung-R-2026-139.txt und angebot-2026-026.txt). Sie stehen AUSGESCHRIEBEN
// da und nicht als Regel: Ein Beispiel trägt den Ton, eine Regel beschreibt ihn
// nur.
const VORBILD = `So schreibt das Haus (gekürzte Auszüge aus zwei echten Belegen):

RECHNUNG R-2026-139 an die Anderka GmbH — eine Position, ein Fließtext, kein Anschreiben:
"Abschlagsrechnung (50 %) – Erstellung einer professionellen Website für die Anderka GmbH inkl. individuellem, responsivem Webdesign, Aufbau aller Unterseiten, technischer On-Page-SEO-Optimierung, KI-Such-Optimierung (GEO / AI-SEO, Schema.org) sowie Online-Stellung (Hosting-Einrichtung, Domain-Verknüpfung, SSL und Go-Live). Diese Abschlagsrechnung umfasst 50 % des vereinbarten Gesamtbetrags von 2.500,00 €; die Schlussrechnung über die verbleibenden 50 % wird nach erfolgreichem Go-Live gestellt."

ANGEBOT 2026-026 an Elektro Albonni — erst Nutzenpunkte, dann eine Position mit Titel und Beschreibung:
Nutzenpunkte:
- Moderner, vollständig mobiloptimierter Auftritt, der auf Desktop, Tablet und Smartphone überzeugt
- Ihre Leistungen klar dargestellt – Elektroinstallation, Reparatur, Wartung und Beratung auf einen Blick
- Bessere Auffindbarkeit bei Google durch technische On-Page-SEO – gezielt für Ihre Region (Bad Wörishofen, Mindelheim, Memmingen)
- KI-Such-Optimierung (GEO / Schema.org) – damit Ihr Betrieb auch von KI-Assistenten korrekt erfasst und empfohlen wird
- Klare Kontaktwege für mehr qualifizierte Anfragen
Position "Erstellung der neuen Webseite":
"Individuelles, responsives Webdesign – optimiert für Desktop, Tablet und Smartphone, inkl. Aufbau aller Unterseiten (u. a. Leistungen, Über uns, Referenzen, Kontakt). Technische On-Page-SEO-Optimierung, KI-Such-Optimierung (GEO / Schema.org) sowie Online-Stellung: Hosting-Einrichtung, Domain-Verknüpfung, SSL und Go-Live."`;

function anweisung(heute = rg.heute()) {
  return `Du hilfst beim Schreiben von Rechnungen und Angeboten einer deutschen Webdesign- und KI-Agentur (svh Consulting, Sehorz & vom Hofe GbR, Zangberg). Du sprichst mit Lukas, dem Geschäftsführer. Ihr sitzt vor demselben Bildschirm: Links steht euer Gespräch, rechts der Beleg, über den ihr redet.

Heute ist der ${rg.datumLang(heute)} (${heute}).

ES GIBT IMMER NUR EINEN BELEG IN DIESEM GESPRÄCH.
· Gibt es noch keinen, legst du ihn mit beleg_anlegen an — einmal.
· Gibt es schon einen, ÄNDERST du ihn mit beleg_aendern. Auch bei "mach 900 daraus", "setz das Datum auf den 1.", "schreib noch eine Position dazu", "nenn es anders". Niemals einen zweiten anlegen.
· Will Lukas wirklich einen weiteren Beleg, sag ihm, dass er dafür oben "Neuer Beleg" antippt — dann fängt ein eigenes Gespräch an. Ein zweiter Beleg in diesem Faden ist nicht möglich, und das ist Absicht.

RATE NICHTS.
· Fehlt der Kunde, frag nach. Steht ein Name da, such ihn mit kunde_suchen — ohne CRM-Treffer fehlen Adresse und Mailadresse auf dem Beleg.
· Liefert kunde_suchen mehrere Treffer, zeig sie mit ihrem Ort und frag, welcher gemeint ist. Rate nicht am Namensanfang entlang: "Anderka" passt auf zwei Kunden, und ein Beleg beim falschen Empfänger ist ein Anruf wert.
· Fehlt der Betrag oder die Leistung, frag danach, statt eine plausible Zahl zu erfinden. Eine erfundene Zahl fällt beim Prüfen nicht auf und landet beim Kunden.

ZAHLEN
· Alle Beträge sind ENDPREISE. Kleinunternehmerregelung nach § 19 UStG — keine Umsatzsteuer, kein Netto, kein "zzgl. MwSt.". Erwähne Umsatzsteuer nirgends.
· Deutsche Zahlformate: "2.500 €" = 2500, "2.500,50" = 2500.5, "zweitausendfünfhundert" = 2500. Gib immer eine Zahl zurück, nie einen Text mit Währungszeichen.
· "Mach 900 daraus" heißt: der Preis der einen Position wird 900. Hat der Beleg mehrere Zeilen, frag nach, welche gemeint ist.

DATUM
· Immer JJJJ-MM-TT. Löse "heute", "morgen", "nächsten Montag", "am 1.", "15.9." und "in zwei Wochen" gegen das oben genannte heutige Datum auf.
· "Zahlungsziel 14 Tage" gehört nach faellig_tage, nicht ins Belegdatum.

TEXT AUF DEM BELEG
· Sie-Form, konkret, ohne Superlative und ohne Floskelketten.
· Die RECHNUNG hat keine Anrede, keine Einleitung, keinen Schlussabsatz und keine Nutzenpunkte — sie geht von der Überschrift direkt in die Tabelle.
· Das ANGEBOT hat 4 bis 5 Nutzenpunkte, die sagen, was DIESER Kunde davon hat, nicht was ihr tut. Mindestens zwei greifen seine Branche auf.
· Erfinde keine Leistungen, die nicht genannt wurden.

DEINE ANTWORT IM CHAT
· Ein bis zwei Sätze, was du getan hast. Nicht den ganzen Beleg aufzählen — der steht rechts daneben und wird nach jeder Änderung neu geladen.
· Konnte etwas nicht gespeichert werden, sag genau das und warum, in einem Satz.
· Kein "Gerne!", keine Aufzählungszeichen, keine Überschriften. Du redest mit einem Kollegen, nicht mit einem Formular.

${VORBILD}`;
}

// ================================================================ Beleg als Text
//
// Derselbe Text geht an das Modell (beleg_zeigen und der Kopf jeder Runde).
// Positionsnummern sind 1-basiert und stimmen mit position_weg/position_aendern
// überein — daran hängt, ob "die zweite Zeile raus" die richtige trifft.
function belegText(r) {
  if (!r) return "Es gibt in diesem Gespräch noch keinen Beleg.";
  const art = r.art === "angebot" ? "Angebot" : "Rechnung";
  const e = r.empfaenger || {};
  const zeilen = [
    `Art: ${art}`,
    `Nummer: ${r.nummer || "noch keine (Entwurf)"}`,
    `Status: ${rg.STATUS_TEXT[r.status] || r.status}${r.status === "entwurf" ? " — änderbar" : " — NICHT mehr änderbar"}`,
    `Empfänger: ${[e.name, e.ansprechperson && `${e.anrede || ""} ${e.ansprechperson}`.trim(), e.strasse, e.plz_ort, e.email]
      .filter(Boolean).join(", ") || "fehlt"}`,
    `Kunde im CRM: ${r.firma_id ? `Nr. ${r.firma_id}${r.firma_name ? ` (${r.firma_name})` : ""}` : "nicht verknüpft"}`,
    `Kurzbezeichnung: ${r.titel || "—"}`,
    `Vorlage: ${r.vorlage || "frei"}`,
    `Belegdatum: ${r.datum}`,
    `${r.art === "angebot" ? "Gültig bis" : "Fällig am"}: ${r.faellig}`,
  ];
  if (r.abschlag_von) zeilen.push(`Abschlag ${r.abschlag_nr || 1} über ${r.abschlag_prozent} % eines Auftrags (Nr. ${r.abschlag_von}) — Prozentsatz und Bezug lassen sich hier nicht ändern.`);
  zeilen.push("Positionen:");
  const pos = Array.isArray(r.positionen) ? r.positionen : [];
  if (!pos.length) zeilen.push("  (keine)");
  for (let i = 0; i < pos.length; i++) {
    const p = pos[i];
    zeilen.push(`  ${i + 1}. ${p.titel || "(ohne Titel)"} — ${String(p.menge ?? 1).replace(".", ",")} ${p.einheit || "pauschal"} × ${rg.euro(p.einzelpreis)} = ${rg.euro(rg.positionSumme(p))}`);
    if (p.beschreibung) zeilen.push(`     ${s(p.beschreibung, 400)}`);
  }
  zeilen.push(`Summe: ${rg.euro(r.summe)}`);
  if (r.art === "angebot") {
    const n = rg.nutzenListe(r);
    if (n.length) zeilen.push(`Nutzenpunkte: ${n.map((x) => `„${x}"`).join(" · ")}`);
    if (r.einleitung) zeilen.push(`Einleitung: ${s(r.einleitung, 300)}`);
    if (r.schluss) zeilen.push(`Schluss: ${s(r.schluss, 300)}`);
  }
  return zeilen.join("\n");
}

// ============================================================= Nachprüfung
//
// Eine Position, die aus dem Modell kommt. Liefert null und eine Warnung, wenn
// sie nicht taugt — statt einer Zeile mit "0,00 €" im PDF beim Kunden.
// bestandsPreis: Der Preis stand schon im Beleg und wird gerade nicht
// angefasst. Dann gilt er, wie er ist — auch negativ. Negative Zeilen gibt es
// wirklich: Eine Schlussrechnung zieht die bezahlten Abschläge wieder ab
// (rg.umwandeln), und wer daran nur den Titel ändert, soll nicht plötzlich
// eine Warnung über einen "nicht plausiblen Preis" lesen.
function positionSaeubern(p, warnungen, wo = "", { bestandsPreis = false } = {}) {
  if (!p || typeof p !== "object") return null;
  const titel = s(p.titel, 160);
  const preis = rg.zuBetrag(p.einzelpreis);
  if (!titel) { warnungen.push(`Eine Zeile ohne Titel wurde nicht übernommen${wo}.`); return null; }
  if (preis === null) { warnungen.push(`Für „${titel}" stand kein Preis dabei — die Zeile wurde nicht übernommen.`); return null; }
  if (bestandsPreis ? Math.abs(preis) > bd.MAX_BETRAG : (preis <= 0 || preis > bd.MAX_BETRAG)) {
    warnungen.push(`Der Preis ${rg.euro(preis)} in der Zeile „${titel}" ist nicht plausibel — die Zeile wurde nicht übernommen.`);
    return null;
  }
  let menge = rg.zuBetrag(p.menge);
  if (menge === null || menge <= 0 || menge > 100000) menge = 1;
  return {
    titel,
    beschreibung: mehrzeilig(p.beschreibung, 1200),
    menge,
    einheit: rg.EINHEITEN.includes(s(p.einheit, 20)) ? s(p.einheit, 20) : "pauschal",
    einzelpreis: preis,
  };
}

// Eine TEILÄNDERUNG auf einen bestehenden Beleg rechnen.
//
// Was nicht genannt ist, bleibt stehen — das ist der ganze Punkt: "mach 900
// daraus" darf nicht die Adresse, das Datum und die Beschreibung mitnehmen.
// rg.aendern() will trotzdem den vollständigen Datensatz, also wird hier
// zusammengesetzt, nicht dort.
//
// Bestehende Positionen, die NICHT angefasst werden, gehen unverändert durch —
// auch wenn sie einen negativen Preis tragen (Abzugszeilen einer
// Schlussrechnung). Geprüft wird nur, was das Modell gerade liefert.
//
// Reihenfolge, wenn mehreres zugleich kommt: erst ersetzen, dann ändern, dann
// entfernen, dann anhängen. So beziehen sich die Nummern in position_aendern
// und position_weg auf den Stand, den das Modell in beleg_zeigen gesehen hat.
function aenderungSaeubern(r, felder, { heute = rg.heute() } = {}) {
  const f = felder && typeof felder === "object" ? felder : {};
  const warnungen = [];
  const geaendert = [];
  const hat = (k) => Object.prototype.hasOwnProperty.call(f, k) && f[k] !== null && f[k] !== undefined && f[k] !== "";
  const istAngebot = (f.art === "angebot" || f.art === "rechnung") ? f.art === "angebot" : r.art === "angebot";

  const w = {
    firma_id: r.firma_id,
    empfaenger: { ...(r.empfaenger || {}) },
    datum: r.datum,
    faellig: r.faellig,
    positionen: (Array.isArray(r.positionen) ? r.positionen : []).map((p) => ({ ...p })),
    vorlage: r.vorlage || "frei",
    titel: r.titel || "",
    einleitung: r.einleitung || "",
    schluss: r.schluss || "",
    nutzen: r.nutzen || "",
  };

  // --- Empfänger und Kunde
  if (hat("firma_id") || f.firma_id === null) {
    const id = zahl(f.firma_id);
    if (id !== null) { w.firma_id = id; geaendert.push("Kunde"); }
  }
  if (f.empfaenger && typeof f.empfaenger === "object") {
    for (const k of ["name", "ansprechperson", "strasse", "plz_ort", "email"]) {
      if (typeof f.empfaenger[k] === "string" && f.empfaenger[k].trim()) {
        w.empfaenger[k] = s(f.empfaenger[k], 200); geaendert.push("Empfänger");
      }
    }
    if (["Herr", "Frau", ""].includes(f.empfaenger.anrede)) { w.empfaenger.anrede = f.empfaenger.anrede; geaendert.push("Empfänger"); }
  }

  // --- Kurzbezeichnung und Vorlage
  if (hat("titel")) { w.titel = s(f.titel, 120); geaendert.push("Kurzbezeichnung"); }
  if (hat("vorlage")) {
    if (bd.VORLAGEN.includes(f.vorlage)) { w.vorlage = f.vorlage; geaendert.push("Vorlage"); }
    else warnungen.push(`Die Vorlage „${s(f.vorlage, 30)}" gibt es nicht — sie blieb, wie sie war.`);
  }

  // --- Datum. Erst auflösen ("am 1." → JJJJ-MM-TT), dann auf Plausibilität
  // prüfen. Ein Datum, das nicht durchkommt, wird NICHT still ersetzt: Auf dem
  // Blatt beim Kunden steht es, und im Umsatzfenster der Buchhaltung zählt es.
  if (hat("datum")) {
    const d = bd.datumAufloesen(f.datum, heute);
    if (d && bd.datumPlausibel(d, heute)) {
      // Die Frist wandert mit, solange nichts anderes gesagt wurde — sonst
      // stünde nach "setz das Datum auf den 1." ein Beleg da, der schon
      // fällig war, bevor er geschrieben wurde.
      if (!hat("faellig") && !hat("faellig_tage")) {
        const alt = Math.round((new Date(`${w.faellig}T12:00:00`) - new Date(`${w.datum}T12:00:00`)) / 86400000);
        w.faellig = rg.tageSpaeter(d, Number.isFinite(alt) && alt >= 0 ? alt : rg.FRIST_TAGE[istAngebot ? "angebot" : "rechnung"]);
      }
      w.datum = d;
      geaendert.push("Belegdatum");
    } else {
      warnungen.push(`„${s(f.datum, 40)}" ergibt kein brauchbares Belegdatum — das Datum blieb der ${rg.datumDe(w.datum)}.`);
    }
  }
  if (hat("faellig")) {
    const d = bd.datumAufloesen(f.faellig, heute);
    if (d && bd.datumPlausibel(d, heute)) { w.faellig = d; geaendert.push(istAngebot ? "Gültigkeit" : "Zahlungsziel"); }
    else warnungen.push(`„${s(f.faellig, 40)}" ergibt kein brauchbares Fälligkeitsdatum — es blieb der ${rg.datumDe(w.faellig)}.`);
  } else if (hat("faellig_tage")) {
    const t = rg.zuBetrag(f.faellig_tage);
    if (t !== null && t >= 0 && t <= 365) { w.faellig = rg.tageSpaeter(w.datum, Math.round(t)); geaendert.push(istAngebot ? "Gültigkeit" : "Zahlungsziel"); }
    else warnungen.push(`Ein Zahlungsziel von ${s(f.faellig_tage, 20)} Tagen ist nicht plausibel — es blieb, wie es war.`);
  }

  // --- Positionen
  if (Array.isArray(f.positionen) && f.positionen.length) {
    const neu = [];
    for (const p of f.positionen) { const x = positionSaeubern(p, warnungen); if (x) neu.push(x); }
    if (neu.length) { w.positionen = neu.slice(0, 20); geaendert.push("Positionen"); }
    else warnungen.push("Von den neuen Zeilen war keine brauchbar — die bisherigen bleiben stehen.");
  }
  if (f.position_aendern && typeof f.position_aendern === "object") {
    const nr = zahl(f.position_aendern.nr);
    const i = nr === null ? -1 : nr - 1;
    if (i < 0 || i >= w.positionen.length) {
      warnungen.push(`Eine Zeile Nummer ${s(f.position_aendern.nr, 10) || "?"} gibt es nicht — der Beleg hat ${w.positionen.length} ${w.positionen.length === 1 ? "Zeile" : "Zeilen"}.`);
    } else {
      const alt = w.positionen[i];
      const roh = { ...alt };
      let preisNeu = false;
      for (const k of ["titel", "beschreibung", "einheit"]) if (typeof f.position_aendern[k] === "string" && f.position_aendern[k].trim()) roh[k] = f.position_aendern[k];
      for (const k of ["menge", "einzelpreis"]) {
        if (f.position_aendern[k] !== undefined && f.position_aendern[k] !== null && f.position_aendern[k] !== "") {
          roh[k] = f.position_aendern[k];
          if (k === "einzelpreis") preisNeu = true;
        }
      }
      const x = positionSaeubern(roh, warnungen, ` (Zeile ${nr})`, { bestandsPreis: !preisNeu });
      if (x) { w.positionen[i] = x; geaendert.push(`Zeile ${nr}`); }
    }
  }
  if (f.position_weg !== undefined && f.position_weg !== null && f.position_weg !== "") {
    const nr = zahl(f.position_weg);
    const i = nr === null ? -1 : nr - 1;
    if (i < 0 || i >= w.positionen.length) warnungen.push(`Eine Zeile Nummer ${s(f.position_weg, 10)} gibt es nicht — es wurde nichts entfernt.`);
    else if (w.positionen.length === 1) warnungen.push("Die letzte Zeile lässt sich nicht entfernen — ein Beleg ohne Leistung geht nicht. Ändere sie stattdessen.");
    else { geaendert.push(`Zeile ${nr} entfernt`); w.positionen.splice(i, 1); }
  }
  if (f.position_hinzu && typeof f.position_hinzu === "object") {
    const x = positionSaeubern(f.position_hinzu, warnungen);
    if (x && w.positionen.length >= 20) warnungen.push("Mehr als 20 Zeilen nimmt ein Beleg nicht — die neue wurde nicht angehängt.");
    else if (x) { w.positionen.push(x); geaendert.push("Position dazu"); }
  }

  // --- Texte. Auf der Rechnung gibt es sie nicht (Hausvorlage) — was das
  // Modell trotzdem schreibt, fällt hier weg statt im PDF aufzutauchen.
  if (hat("einleitung")) { w.einleitung = istAngebot ? mehrzeilig(f.einleitung, 2000) : ""; geaendert.push("Einleitung"); }
  if (hat("schluss")) { w.schluss = istAngebot ? mehrzeilig(f.schluss, 2000) : ""; geaendert.push("Schlusstext"); }
  if (Array.isArray(f.nutzen)) {
    const n = f.nutzen.map((x) => s(x, 300).replace(/[.;]+$/, "")).filter((x) => x.length > 10).slice(0, 5);
    if (istAngebot && n.length) { w.nutzen = n.join("\n"); geaendert.push("Nutzenpunkte"); }
  }
  if (!istAngebot) { w.einleitung = ""; w.schluss = ""; w.nutzen = ""; }

  return { werte: w, warnungen, geaendert: [...new Set(geaendert)], istAngebot };
}

// ================================================================ Speicher
//
// Der Faden liegt in beleg_chat (Migration 0063). rechnung_id ist der Faden
// selbst: solange NULL, redet man über nichts Bestimmtes.
const CHAT_SPALTEN = `id, rechnung_id, nutzer, nachrichten,
  to_char(erstellt,'YYYY-MM-DD"T"HH24:MI:SSOF') as erstellt,
  to_char(geaendert,'YYYY-MM-DD"T"HH24:MI:SSOF') as geaendert`;

function chatZeile(x) {
  if (!x) return null;
  return {
    id: Number(x.id),
    rechnung_id: x.rechnung_id === null || x.rechnung_id === undefined ? null : Number(x.rechnung_id),
    nutzer: x.nutzer || null,
    nachrichten: Array.isArray(x.nachrichten) ? x.nachrichten : [],
    erstellt: x.erstellt, geaendert: x.geaendert,
  };
}

// Holt das Gespräch — über die Chat-Nummer oder über den Beleg, an dem es
// hängt. Beides leer heißt: es gibt noch keines.
async function chatHolen(user, { chatId = "", rechnungId = "" } = {}) {
  const cid = zahl(chatId), rid = zahl(rechnungId);
  if (cid === null && rid === null) return null;
  return crm.alsNutzer(user.id, async (q) => {
    if (cid !== null) {
      const { rows } = await q(`select ${CHAT_SPALTEN} from beleg_chat where id = $1`, [cid]);
      const c = chatZeile(rows[0]);
      // Kommt beides, muss es zusammenpassen: Eine Chat-Nummer aus dem
      // Formular und ein Beleg aus der Adresszeile, die auseinanderlaufen,
      // wären der sichere Weg, den falschen Beleg zu ändern.
      if (c && (rid === null || c.rechnung_id === null || c.rechnung_id === rid)) return c;
    }
    if (rid !== null) {
      const { rows } = await q(`select ${CHAT_SPALTEN} from beleg_chat where rechnung_id = $1 order by id limit 1`, [rid]);
      return chatZeile(rows[0]);
    }
    return null;
  });
}

async function chatAnlegen(user, rechnungId = null) {
  const rid = zahl(rechnungId);
  return crm.alsNutzer(user.id, async (q) => {
    const { rows } = await q(
      `insert into beleg_chat (rechnung_id, nutzer, nachrichten) values ($1, $2, '[]'::jsonb) returning ${CHAT_SPALTEN}`,
      [rid, user.id]);
    return chatZeile(rows[0]);
  });
}

// Nachrichten anhängen und (einmalig) den Beleg festnageln. Das Anhängen
// passiert in der Datenbank (nachrichten || $2), nicht im Arbeitsspeicher:
// Zwei Browserfenster auf demselben Gespräch würden sich sonst gegenseitig
// überschreiben.
async function chatSchreiben(user, chatId, neue, { rechnungId = null } = {}) {
  const cid = zahl(chatId);
  if (cid === null || !neue.length) return null;
  const rid = zahl(rechnungId);
  return crm.alsNutzer(user.id, async (q) => {
    const { rows } = await q(
      `update beleg_chat
          set nachrichten = coalesce(nachrichten, '[]'::jsonb) || $2::jsonb,
              rechnung_id = coalesce(rechnung_id, $3),
              geaendert = now()
        where id = $1
      returning ${CHAT_SPALTEN}`,
      [cid, JSON.stringify(neue), rid]);
    return chatZeile(rows[0]);
  });
}

// Das zuletzt geführte Gespräch dieses Nutzers — für den Fall, dass jemand die
// Seite ohne Adresszusatz öffnet und dort weitermachen will, wo er aufgehört
// hat. Nur Gespräche, die einen Beleg tragen: ein abgebrochener Faden ohne
// Beleg ist nichts, wohin man zurückkehren möchte.
async function letztesGespraech(user) {
  return crm.alsNutzer(user.id, async (q) => {
    const { rows } = await q(
      `select ${CHAT_SPALTEN} from beleg_chat
        where nutzer = $1 and rechnung_id is not null
        order by geaendert desc limit 1`, [user.id]);
    return chatZeile(rows[0]);
  });
}

// =========================================================== Werkzeugschleife

// Was das Modell in einer Runde gesehen und getan hat, als Text für die
// nächste Runde.
function rundenText(runden) {
  if (!runden.length) return "";
  return "\n\n" + runden.map((r, i) => [
    `DEINE WERKZEUGE IN RUNDE ${i + 1}:`,
    ...r.map((a) => `${a.name}(${JSON.stringify(a.ein).slice(0, 900)})\nErgebnis: ${a.ergebnis}`),
  ].join("\n")).join("\n\n");
}

function verlaufText(verlauf) {
  if (!verlauf.length) return "Ihr habt noch nicht miteinander geredet.";
  return verlauf.slice(-MAX_VERLAUF).map((n) => {
    const wer = n.rolle === "nutzer" ? "Lukas" : (n.rolle === "assistent" ? "Du" : "System");
    return `${wer}: ${s(n.text, 1200)}`;
  }).join("\n");
}

function frageText({ verlauf, beleg, frage, runden }) {
  return [
    "DER BELEG, ÜBER DEN IHR REDET:",
    belegText(beleg),
    "",
    "BISHERIGES GESPRÄCH:",
    verlaufText(verlauf),
    "",
    "NEUE NACHRICHT VON LUKAS:",
    frage,
  ].join("\n") + rundenText(runden);
}

// Ein Werkzeug ausführen. Liefert IMMER einen Text für das Modell — auch wenn
// nichts geschrieben wurde. "Abgelehnt, weil …" ist eine brauchbare Antwort,
// ein stiller Fehlschlag nicht.
async function werkzeugAusfuehren(user, name, ein, z) {
  const f = ein && typeof ein === "object" ? ein : {};

  if (name === "kunde_suchen") {
    const suche = s(f.name, 80);
    if (!suche) return "Ohne Namen kann ich nicht suchen.";
    let treffer = [];
    try { treffer = await crm.firmenListe(user, { suche, limit: 5 }); } catch { treffer = []; }
    if (!treffer.length) return `Kein Kunde mit „${suche}" im CRM. Du kannst den Beleg trotzdem anlegen — dann kommt der Empfängername aus dem Gespräch, Adresse und Mailadresse fehlen.`;
    const zeilen = treffer.map((x) => `[${x.id}] ${x.name}${x.ort ? `, ${x.ort}` : ""}${x.geschaeftsfuehrer ? ` · ${x.geschaeftsfuehrer}` : ""}${x.adresse ? ` · ${x.adresse}${x.plz ? `, ${x.plz} ${x.ort || ""}` : ""}` : ""}${x.email ? ` · ${x.email}` : ""}`);
    return `${treffer.length} Treffer:\n${zeilen.join("\n")}${treffer.length > 1 ? "\nMehr als einer — frag Lukas, welcher gemeint ist, statt zu raten." : ""}`;
  }

  if (name === "beleg_zeigen") return belegText(z.beleg);

  if (name === "beleg_anlegen") {
    // DIE REGEL, IM CODE. Siehe Kopf der Datei: Ein missverstandener Satz darf
    // keinen zweiten Beleg anlegen können.
    if (z.beleg) {
      return `Abgelehnt: In diesem Gespräch gibt es schon einen Beleg (${z.beleg.nummer || "Entwurf"}, ${rg.euro(z.beleg.summe)}). Ändere ihn mit beleg_aendern. Für einen zweiten Beleg tippt Lukas oben „Neuer Beleg" an — sag ihm das.`;
    }
    const art = ["angebot", "rechnung"].includes(f.art) ? f.art : "rechnung";
    // Dieselbe Nachprüfungsebene wie im Diktat: Beträge, Datum, Vorlage,
    // Positionen mit Titel UND Preis.
    const entwurf = bd.saeubern({
      art,
      firma: s((f.empfaenger || {}).name, 160),
      ansprechpartner: s((f.empfaenger || {}).ansprechperson, 120),
      anrede: (f.empfaenger || {}).anrede,
      titel: f.titel, vorlage: f.vorlage, datum: f.datum, faellig_tage: f.faellig_tage,
      positionen: f.positionen, einleitung: f.einleitung, nutzen: f.nutzen, schluss: f.schluss,
      sicherheit: "hoch",
    }, { art, heute: z.heute });

    if (!entwurf.positionen.length) {
      z.warnungen.push(...entwurf.warnungen);
      return `Nicht angelegt: ${entwurf.warnungen.join(" ") || "Es fehlt eine Zeile mit Titel und Preis."} Frag nach, was fehlt.`;
    }

    let firma = null;
    const fid = zahl(f.firma_id);
    if (fid !== null) {
      try { firma = (await bd.firmaZuordnen(user, "", String(fid))).firma; } catch { firma = null; }
      if (!firma) z.warnungen.push(`Den Kunden mit der Nummer ${fid} gibt es nicht — der Beleg wurde ohne Kundenakte angelegt.`);
    }
    // Was ausdrücklich gesagt wurde, gewinnt über die Akte (der Empfänger auf
    // dem Beleg kann von den Stammdaten abweichen — anderer Ansprechpartner,
    // abweichende Rechnungsadresse).
    const erg = await bd.entwurfAnlegen(user, entwurf, { firma });
    if (!erg.ok) {
      const grund = { empfaenger: "Es fehlt der Name des Empfängers.", positionen: "Es fehlt eine Zeile mit Titel und Preis.",
        "zu-gross": "Der Betrag ist zu groß für einen Beleg.", firma: "Den Kunden gibt es nicht.",
        datum: "Das Datum ist keines." }[erg.grund] || `Grund: ${erg.grund}`;
      z.warnungen.push(grund);
      return `Nicht angelegt. ${grund}`;
    }
    const nachEmpf = f.empfaenger && typeof f.empfaenger === "object" ? f.empfaenger : null;
    z.rechnungId = erg.id;
    z.beleg = await rg.eine(user, erg.id);
    // Adresse und Mailadresse, die im Gespräch genannt wurden, aber nicht in
    // der Akte stehen, nachtragen — sie gingen sonst verloren.
    //
    // NUR LEERE FELDER. Die Akte gewinnt über den Zuruf: Wer "Rechnung für
    // Anderka" sagt, meint die "Anderka GmbH" mit der Adresse aus dem CRM.
    // Würde hier der zugerufene Name zurückgeschrieben, stünde am Ende
    // "Anderka" auf dem Blatt und die Straße darunter.
    if (nachEmpf && z.beleg) {
      const luecken = {};
      for (const k of ["strasse", "plz_ort", "email", "ansprechperson"]) {
        if (!s((z.beleg.empfaenger || {})[k], 200) && typeof nachEmpf[k] === "string" && nachEmpf[k].trim()) luecken[k] = nachEmpf[k];
      }
      if (Object.keys(luecken).length) {
        const nach = aenderungSaeubern(z.beleg, { empfaenger: luecken }, { heute: z.heute });
        const a = await rg.aendern(user, erg.id, nach.werte);
        if (a.ok) z.beleg = await rg.eine(user, erg.id);
      }
    }
    z.taten.push({ art: "anlegen", felder: [entwurf.art === "angebot" ? "Angebot" : "Rechnung", rg.euro(entwurf.summe)] });
    if (entwurf.warnungen.length) z.warnungen.push(...entwurf.warnungen);
    return `Angelegt als Entwurf.\n${belegText(z.beleg)}${entwurf.warnungen.length ? `\nHinweise: ${entwurf.warnungen.join(" ")}` : ""}`;
  }

  if (name === "beleg_aendern") {
    if (!z.beleg) return "Abgelehnt: In diesem Gespräch gibt es noch keinen Beleg. Leg ihn erst mit beleg_anlegen an.";
    if (z.beleg.status !== "entwurf") {
      return `Abgelehnt: ${z.beleg.nummer || "Der Beleg"} ist nicht mehr im Entwurf, sondern ${rg.STATUS_TEXT[z.beleg.status] || z.beleg.status}. Ein Beleg mit Nummer wird nicht mehr geändert — er würde beim Kunden anders aussehen als in der Buchhaltung. Sag Lukas, dass er ihn auf der Vorgangsseite stornieren und neu schreiben muss.`;
    }
    const nach = aenderungSaeubern(z.beleg, f, { heute: z.heute });
    const artNeu = ["angebot", "rechnung"].includes(f.art) && f.art !== z.beleg.art ? f.art : null;
    if (!nach.geaendert.length && !artNeu) {
      z.warnungen.push(...nach.warnungen);
      return `Nichts geändert. ${nach.warnungen.join(" ") || "In dem Aufruf stand kein Feld, das sich ändern lässt."}`;
    }

    if (artNeu) {
      const erg = await artWechseln(user, z, nach.werte, artNeu);
      if (!erg.ok) { z.warnungen.push(erg.text); return `Nicht geändert. ${erg.text}`; }
      z.taten.push({ art: "art-wechsel", felder: [artNeu === "angebot" ? "jetzt Angebot" : "jetzt Rechnung", ...nach.geaendert] });
      if (nach.warnungen.length) z.warnungen.push(...nach.warnungen);
      return `Aus ${z.beleg.art === "angebot" ? "der Rechnung" : "dem Angebot"} ist ${artNeu === "angebot" ? "ein Angebot" : "eine Rechnung"} geworden.\n${belegText(z.beleg)}`;
    }

    const erg = await rg.aendern(user, z.beleg.id, nach.werte);
    if (!erg.ok) {
      const grund = { "nur-entwurf": "Der Beleg ist nicht mehr im Entwurf.", empfaenger: "Ohne Empfängernamen geht es nicht.",
        positionen: "Ohne eine Zeile mit Titel geht es nicht.", "zu-gross": "Der Betrag ist zu groß für einen Beleg.",
        mail: "Die Mailadresse ist unvollständig.", firma: "Den Kunden gibt es nicht.", datum: "Das Datum ist keines.",
        "nicht-gefunden": "Den Beleg gibt es nicht mehr." }[erg.grund] || `Grund: ${erg.grund}`;
      z.warnungen.push(grund);
      return `Nicht geändert. ${grund}`;
    }
    z.beleg = await rg.eine(user, z.beleg.id);
    z.taten.push({ art: "aendern", felder: nach.geaendert });
    if (nach.warnungen.length) z.warnungen.push(...nach.warnungen);
    return `Geändert (${nach.geaendert.join(", ")}).\n${belegText(z.beleg)}${nach.warnungen.length ? `\nHinweise: ${nach.warnungen.join(" ")}` : ""}`;
  }

  return `Das Werkzeug „${s(name, 40)}" gibt es nicht.`;
}

// "Mach ein Angebot draus."
//
// rg.aendern() kann die Art nicht umstellen (die Art entscheidet über Vorlage,
// Nummernkreis und Statusmodell) — also entsteht ein NEUER Entwurf mit
// denselben Angaben, das Gespräch zieht mit, und der alte Entwurf wird
// gelöscht. Reihenfolge zwingend: erst umhängen, dann löschen. Andersherum
// nähme das "on delete cascade" aus 0063 das ganze Gespräch mit.
//
// Es bleibt genau EIN Beleg im Faden — nur mit einer neuen Nummer in der
// Datenbank. Entwürfe haben keine Belegnummer, also geht dabei keine verloren.
async function artWechseln(user, z, werte, artNeu) {
  const alt = z.beleg;
  if (alt.status !== "entwurf") return { ok: false, text: "Nur ein Entwurf lässt sich umwandeln." };
  if (alt.abschlag_von || alt.angebot_id) {
    return { ok: false, text: "Dieser Beleg hängt an einem Auftrag (Abschlag bzw. aus einem Angebot entstanden) — die Art lässt sich nicht mehr wechseln." };
  }
  const istAngebot = artNeu === "angebot";
  const standard = rg.texte(werte.vorlage || "frei", artNeu);
  const neu = await rg.anlegen(user, {
    ...werte,
    art: artNeu,
    faellig: rg.tageSpaeter(werte.datum, rg.FRIST_TAGE[istAngebot ? "angebot" : "rechnung"]),
    titel: werte.titel || standard.titel,
    einleitung: istAngebot ? (werte.einleitung || standard.einleitung) : "",
    schluss: istAngebot ? (werte.schluss || standard.schluss) : "",
    nutzen: istAngebot ? (werte.nutzen || standard.nutzen) : "",
  });
  if (!neu.ok) return { ok: false, text: `Der neue Beleg ließ sich nicht anlegen (${neu.grund}).` };

  await crm.alsNutzer(user.id, (q) => q(`update beleg_chat set rechnung_id = $2, geaendert = now() where id = $1`, [z.chatId, neu.id]));
  z.rechnungId = neu.id;
  z.beleg = await rg.eine(user, neu.id);
  // Der alte Entwurf hat jetzt kein Gespräch mehr und wäre eine Karteileiche.
  try { await rg.loeschen(user, alt.id); } catch { /* bleibt als Entwurf liegen — kein Grund, den Wechsel zu verwerfen */ }
  return { ok: true };
}

// ================================================================= Antworten
//
// Der eine Zug: Verlauf laden, Modell fragen, Werkzeuge laufen lassen,
// Antwort speichern. Wirft nicht wegen des Modells — nur ein Fehler der
// Datenbank kommt durch (dann fehlt meist Migration 0063, und das soll die
// Seite sagen dürfen).
async function antworten(user, { text = "", rechnungId = "", chatId = "", heute = rg.heute() } = {}) {
  const frage = mehrzeilig(text, MAX_TEXT);

  let chat = await chatHolen(user, { chatId, rechnungId });
  if (!chat) {
    // Der Beleg aus der Adresszeile wird NACHGESEHEN, bevor der Faden daran
    // gehaengt wird. Sonst laeuft ein veralteter Reiter (Beleg inzwischen
    // geloescht oder beim Artwechsel neu angelegt) in einen
    // Fremdschluesselfehler und damit in einen 500 statt in ein Gespraech,
    // das eben ohne Beleg anfaengt.
    const rid = zahl(rechnungId);
    const da = rid !== null ? await rg.eine(user, rid) : null;
    chat = await chatAnlegen(user, da ? rid : null);
  }
  const belegId = chat.rechnung_id !== null ? chat.rechnung_id : zahl(rechnungId);
  let beleg = belegId !== null ? await rg.eine(user, belegId) : null;

  if (!frage) {
    return { ok: false, grund: "leer", chatId: chat.id, rechnungId: beleg ? beleg.id : null,
      antwort: "Da stand nichts. Schreib in ein paar Worten, für wen der Beleg ist, was drauf soll und was es kostet.",
      tat: null, beleg, verlauf: chat.nachrichten, warnungen: [] };
  }

  const nutzerNachricht = { rolle: "nutzer", text: frage, zeit: jetzt() };

  // ---------------------------------------------------------- ohne Modell
  //
  // Nichts scheitert hart. Ohne Beleg entsteht ein leerer Entwurf mit dem Text
  // als Notiz (wie im Diktat), mit Beleg bleibt der Satz als Notiz im Verlauf
  // stehen — dann kann Lukas ihn auf dem Server noch einmal absenden oder im
  // Formular eintragen.
  if (!bereit()) {
    let antwort, tat = null, neueId = null;
    if (!beleg) {
      const leer = bd.leererEntwurf(frage, { art: /angebot/i.test(frage) ? "angebot" : "rechnung", heute });
      leer.firma = ersterName(frage);
      const erg = await bd.entwurfAnlegen(user, leer, { firma: null });
      if (erg.ok) {
        neueId = erg.id;
        beleg = await rg.eine(user, erg.id);
        tat = { art: "anlegen", felder: ["leerer Entwurf"] };
        antwort = "Ohne Sprachmodell kann ich aus deinem Text keinen fertigen Beleg bauen — auf dem Server läuft es. "
          + "Ich habe einen leeren Entwurf angelegt und deinen Satz als Notiz hineingeschrieben; Zahlen und Kunde trägst du im Formular nach.";
      } else {
        antwort = "Ohne Sprachmodell kann ich aus deinem Text keinen Beleg bauen — auf dem Server läuft es. "
          + "Für einen leeren Entwurf fehlt mir hier der Name des Empfängers; nimm so lange das Formular.";
      }
    } else {
      antwort = "Ohne Sprachmodell kann ich den Beleg nicht ändern — auf dem Server läuft es. "
        + "Dein Satz steht im Verlauf; ändere ihn so lange im Formular.";
    }
    const nachrichten = [nutzerNachricht, { rolle: "assistent", text: antwort, zeit: jetzt(), ...(tat ? { tat } : {}) }];
    const c = await chatSchreiben(user, chat.id, nachrichten, { rechnungId: neueId });
    return { ok: false, grund: "kein-modell", chatId: chat.id, rechnungId: beleg ? beleg.id : null,
      antwort, tat, beleg, verlauf: (c || chat).nachrichten, warnungen: [] };
  }

  // ------------------------------------------------------- Werkzeugschleife
  const z = { chatId: chat.id, rechnungId: beleg ? beleg.id : null, beleg, heute, taten: [], warnungen: [] };
  const runden = [];
  let antwortText = "";
  let abgebrochen = false;
  let fehler = "";

  for (let runde = 0; runde < MAX_RUNDEN; runde++) {
    let a;
    try {
      a = await schnell.mitWerkzeugen(
        anweisung(heute),
        frageText({ verlauf: chat.nachrichten, beleg: z.beleg, frage, runden }),
        WERKZEUGE,
        { maxTokens: 3000, model: MODELL, timeoutMs: 45000, aufwand: "medium" },
      );
    } catch (e) {
      fehler = String((e && e.message) || e).slice(0, 200);
      break;
    }
    if (a && a.text) antwortText = String(a.text).slice(0, 2000);
    const aufrufe = (a && Array.isArray(a.aufrufe) ? a.aufrufe : []).slice(0, 4);
    if (!aufrufe.length) break;

    const dieseRunde = [];
    for (const auf of aufrufe) {
      let ergebnis;
      try { ergebnis = await werkzeugAusfuehren(user, auf.name, auf.input, z); }
      catch (e) { ergebnis = `Das Werkzeug ist gescheitert: ${String((e && e.message) || e).slice(0, 160)}`; }
      dieseRunde.push({ name: auf.name, ein: auf.input || {}, ergebnis: String(ergebnis).slice(0, 3000) });
    }
    runden.push(dieseRunde);
    if (runde === MAX_RUNDEN - 1) abgebrochen = true;
  }

  // Was der Chat am Ende sagt. Reihenfolge: eigener Satz des Modells, sonst
  // eine Zusammenfassung dessen, was tatsächlich passiert ist — nie Schweigen.
  let antwort = antwortText.trim();
  if (fehler) {
    antwort = z.taten.length
      ? `${tatenSatz(z.taten)} Danach ist die Verbindung zum Sprachmodell abgerissen (${fehler}). Sag es noch einmal, wenn etwas fehlt.`
      : `Ich komme gerade nicht ans Sprachmodell (${fehler}). Der Beleg ist unverändert — versuch es gleich noch einmal.`;
  } else if (abgebrochen && !antwort) {
    antwort = z.taten.length
      ? `${tatenSatz(z.taten)} Danach habe ich abgebrochen, weil ich mich im Kreis gedreht habe. Schau rechts, ob es passt.`
      : "Ich habe mich im Kreis gedreht und abgebrochen, ohne etwas zu ändern. Sag es bitte anders — am besten mit Kunde, Leistung und Betrag in einem Satz.";
  } else if (!antwort) {
    antwort = z.taten.length ? tatenSatz(z.taten)
      : "Dazu habe ich nichts geändert. Sag mir, für wen der Beleg ist, was drauf soll und was es kostet.";
  }
  if (z.warnungen.length) antwort += `\n\n${[...new Set(z.warnungen)].join(" ")}`;

  const tat = z.taten.length
    ? { art: z.taten[z.taten.length - 1].art, felder: [...new Set(z.taten.flatMap((t) => t.felder))].slice(0, 8) }
    : null;
  const nachrichten = [nutzerNachricht, { rolle: "assistent", text: antwort.slice(0, MAX_TEXT), zeit: jetzt(), ...(tat ? { tat } : {}) }];
  const c = await chatSchreiben(user, chat.id, nachrichten, { rechnungId: z.rechnungId });

  return {
    ok: !fehler, grund: fehler ? "modell" : (abgebrochen ? "abgebrochen" : ""),
    chatId: chat.id, rechnungId: z.rechnungId, antwort, tat,
    beleg: z.beleg, verlauf: (c || chat).nachrichten, warnungen: [...new Set(z.warnungen)],
    runden: runden.length,
  };
}

function tatenSatz(taten) {
  const letzte = taten[taten.length - 1];
  if (letzte.art === "anlegen") return `${letzte.felder[0] || "Der Beleg"} über ${letzte.felder[1] || "—"} liegt als Entwurf im System.`;
  if (letzte.art === "art-wechsel") return `Umgestellt: ${letzte.felder.join(", ")}.`;
  return `Geändert: ${taten.flatMap((t) => t.felder).join(", ")}.`;
}

// Ohne Modell: den wahrscheinlichsten Kundennamen aus dem Satz fischen, damit
// der leere Entwurf wenigstens einen Empfänger trägt (rg.anlegen verlangt
// einen). Bewusst grob — es ist ein Rückfall, keine Erkennung.
function ersterName(text) {
  const m = String(text).match(/\bf(?:ü|ue)r\s+([A-ZÄÖÜ][\wäöüß.&-]*(?:\s+[A-ZÄÖÜ][\wäöüß.&-]*){0,3})/);
  return m ? s(m[1], 160) : "";
}

module.exports = {
  // Konstanten und reine Funktionen (testbar ohne Datenbank und ohne Modell)
  WERKZEUGE, MODELL, MAX_TEXT, MAX_RUNDEN, MAX_VERLAUF,
  anweisung, belegText, aenderungSaeubern, positionSaeubern, frageText, verlaufText, ersterName, bereit,
  // Mit Datenbank bzw. Modell
  chatHolen, chatAnlegen, chatSchreiben, letztesGespraech, werkzeugAusfuehren, antworten,
};
