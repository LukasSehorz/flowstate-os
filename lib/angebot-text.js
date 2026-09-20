// Den Angebotstext schreiben — Nutzenpunkte und Leistungsbeschreibung.
//
// Warum (Lukas, 07.08.2026): "Wenn ich sage: 'Stell mir ein Angebot für xyz',
// dann hast du da die Vorlage und die soll ausgefüllt werden mit den Infos und
// passend zum Projekt, eben wie ich es beschreibe."
//
// Das ist der Unterschied zur Rechnung. Eine Rechnung hat EINEN Leistungssatz,
// den Lukas selbst diktiert. Ein Angebot hat vier bis fünf Nutzenpunkte, die auf
// den Betrieb des Kunden gemünzt sind — beim Schlüsseldienst steht dort
// "Notöffnungen, Schlüsseldienst, Schließanlagen" und "im Notfall schnell
// finden". Das kann Lukas nicht am Telefon durchdiktieren, und Platzhalter
// wären hier schlimmer als nichts: Ein Angebot mit allgemeinen Floskeln
// verkauft schlechter als gar keins.
//
// EIGENER MODELLAUFRUF, nicht mitgemacht vom Werkzeugaufruf. Zwei Gründe:
//   · Das Werkzeugschema bliebe sonst nicht mehr knapp — fünf Nutzenpunkte und
//     ein 300-Zeichen-Leistungstext als Parameter sind ein eigenes Formular.
//   · Hier kann Lukas' eigener Bestand als Vorbild mitgegeben werden. Der Ton
//     ist dadurch seiner, nicht der eines allgemeinen Angebotsschreibers.

const schnell = require("./schnell.js");

const MODELL = process.env.ANGEBOT_MODELL || "claude-sonnet-5";

// Zwei echte Angebote aus Lukas' Ordner als Vorbild. Sie stehen hier
// AUSGESCHRIEBEN und nicht als Regeln ("schreibe kundennah, nenne Vorteile") —
// ein Beispiel trägt den Ton, eine Regel beschreibt ihn nur.
const VORBILD = `Beispiel 1 — Schlüsseldienst/Sicherheitstechnik, Website, 750 €:
Nutzenpunkte:
- Moderner, vollständig mobiloptimierter Auftritt, der auf Desktop, Tablet und Smartphone überzeugt
- Bessere Auffindbarkeit bei Google durch technische On-Page-SEO
- KI-Such-Optimierung (GEO / Schema.org) – damit Ihr Betrieb auch von KI-Assistenten korrekt erfasst und empfohlen wird
- Klare Darstellung Ihrer Leistungen – von Notöffnungen über Schlüsseldienst bis Schließanlagen – mit gut sichtbaren Kontaktmöglichkeiten für schnelle Anfragen
- Regionaler Fokus auf den Landkreis Mühldorf und Umgebung – damit Kunden Sie im Notfall schnell finden
Posten-Titel: Erstellung der neuen Webseite
Posten-Text: Modernes, responsives Webdesign – optimiert für Desktop, Tablet und Smartphone, inkl. Aufbau aller Unterseiten (u. a. Startseite, Leistungen, Notöffnungen & Schlüsseldienst, Referenzen, Kontakt), technischer On-Page-SEO, KI-Such-Optimierung (GEO / Schema.org) sowie Online-Stellung (Hosting-Einrichtung, Domain-Verknüpfung, SSL und Go-Live).

Beispiel 2 — Unternehmensberatung Personal- & Organisationsentwicklung, Website, 1.500 €:
Nutzenpunkte:
- Ein professioneller, vertrauenswürdiger Auftritt, der Ihre langjährige Beratungskompetenz widerspiegelt
- Gesteigerte Auffindbarkeit bei Unternehmen und Führungskräften in der Google-Suche
- Optimierte Darstellung auf allen Endgeräten – Desktop, Tablet und Smartphone
- Eine suchmaschinenoptimierte Grundlage für alle zukünftigen digitalen Maßnahmen
Posten-Titel: Website-Erstellung (Pauschalpreis)
Posten-Text: Konzeption und Erstellung eines modernen Webauftritts inkl. individuellem Webdesign im Corporate Design, technischer On-Page-SEO-Optimierung, KI-Such-Optimierung (GEO / AI-SEO, Schema.org), responsivem Layout (Desktop, Tablet, Smartphone) sowie vollständiger Online-Stellung (Hosting-Einrichtung, Domain-Verknüpfung, SSL & Go-Live).`;

const SYSTEM = `Du schreibst Angebote für svh Consulting (Sehorz Lukas, vom Hofe Jannik GbR) aus Zangberg — Webdesign, SEO, KI-Suchoptimierung, Social Media.

Du bekommst die Beschreibung eines Projekts und schreibst daraus den Inhalt eines Angebots. Halte dich an den Ton der Beispiele: Sie-Form, konkret, auf den Betrieb des Kunden gemünzt, keine Superlative, keine Floskeln.

${VORBILD}

REGELN, die aus den Beispielen nicht ablesbar sind:
· Jeder Nutzenpunkt nennt etwas, das DIESER Kunde davon hat — nicht was wir tun.
  Also nicht "Wir erstellen eine responsive Website", sondern "Ein Auftritt, der
  auf jedem Gerät überzeugt".
· Mindestens zwei der Punkte müssen die Branche des Kunden aufgreifen. Ein
  Angebot, das für jeden Betrieb passen würde, verkauft nichts.
· Erfinde keine Leistungen, die nicht in der Projektbeschreibung stehen. Wenn
  von Social Media keine Rede ist, steht auch nichts davon im Angebot.
· Steht ein Auszug der Kundenwebsite dabei, nimm daraus die Branche, die
  Leistungen und den Ort auf — aber schreibe keine Formulierung von dort ab. Der
  Kunde erkennt seine eigenen Werbetexte sofort wieder, und dann liest sich das
  Angebot wie eine Rueckspiegelung statt wie ein Vorschlag.
· Was Lukas gesagt hat, wiegt schwerer als CRM und Website. Widersprechen sie
  sich, gilt Lukas.
· Erfinde keine Zahlen, Fristen oder Zusagen. Der Preis kommt von außen.
· Keine Umsatzsteuer erwähnen — Kleinunternehmerregelung.
· Der Posten-Text ist EIN Satz oder ein Satzgefüge, 200 bis 400 Zeichen.`;

const SCHEMA = {
  name: "angebot_inhalt",
  description: "Der geschriebene Inhalt des Angebots.",
  input_schema: {
    type: "object",
    properties: {
      anrede: { type: "string", description: "z. B. 'Sehr geehrter Herr Heuberger,' — mit Komma. Ist kein Name bekannt: 'Sehr geehrte Damen und Herren,'" },
      einleitung: { type: "string", description: "ein Satz, endet mit Doppelpunkt, nennt das Vorhaben: 'vielen Dank für Ihr Interesse! In der folgenden Auflistung sehen Sie auf einen Blick, was wir für Ihren neuen Webauftritt anbieten:'" },
      vorteile: { type: "array", items: { type: "string" }, description: "4 oder 5 Nutzenpunkte, je ein Satz ohne Schlusspunkt" },
      posten_titel: { type: "string", description: "kurz, z. B. 'Erstellung der neuen Webseite'" },
      posten_text: { type: "string", description: "die ausführliche Leistungsbeschreibung, 200-400 Zeichen" },
    },
    required: ["anrede", "einleitung", "vorteile", "posten_titel", "posten_text"],
  },
};

// Was zurückkommt, wird beschnitten und geprüft. Ein Modell, das sechs Punkte
// liefert, würde sonst den sechsten verlieren, ohne dass es jemand merkt — und
// ein leerer Punkt hinterließe eine leere Zeile im Angebot beim Kunden.
function saeubern(w) {
  const s = (x, max) => String(x ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  let vorteile = (Array.isArray(w.vorteile) ? w.vorteile : [])
    .map((v) => s(v, 300).replace(/[.;]+$/, ""))
    .filter((v) => v.length > 15);
  // Die Vorlage hat fünf Zeilen. Mehr passen nicht, weniger werden entfernt.
  vorteile = vorteile.slice(0, 5);
  let anrede = s(w.anrede, 120);
  if (anrede && !/[,:]$/.test(anrede)) anrede += ",";
  let einleitung = s(w.einleitung, 400);
  if (einleitung && !/:$/.test(einleitung)) einleitung += ":";
  return {
    anrede: anrede || "Sehr geehrte Damen und Herren,",
    einleitung: einleitung || "vielen Dank für Ihr Interesse! In der folgenden Auflistung sehen Sie auf einen Blick, was wir für Sie anbieten:",
    vorteile,
    posten_titel: s(w.posten_titel, 120),
    posten_text: s(w.posten_text, 900),
  };
}

// projekt: was Lukas gesagt hat, in seinen Worten.
async function schreiben({ firma, projekt, sparte, betrag, ansprechpartner, ort, crm, website }) {
  const nutzer = [
    `Kunde: ${firma}`,
    ansprechpartner ? `Ansprechpartner: ${ansprechpartner}` : null,
    ort ? `Ort: ${ort}` : null,
    `Bereich: ${sparte || "Website"}`,
    `Preis: ${Number(betrag).toLocaleString("de-DE", { minimumFractionDigits: 2 })} €`,
    "",
    "Projekt, wie Lukas es beschrieben hat:",
    String(projekt || "").slice(0, 2000),
    // Was im CRM steht — Branche, Leistungen, Notiz aus dem Telefonat.
    crm ? `\nWas wir über den Betrieb wissen (CRM):\n${String(crm).slice(0, 1500)}` : null,
    // Die eigene Website des Kunden. Sie steht ZULETZT und ausdruecklich als
    // Hintergrund: Das Modell soll daraus die Branche und die Leistungen
    // aufnehmen, nicht deren Werbetexte abschreiben.
    website ? `\nAuszug von der Website des Kunden (${website.url}) — als Hintergrund, NICHT abschreiben:\n${website.text}` : null,
  ].filter((x) => x !== null).join("\n");

  const r = await schnell.mitWerkzeugen(SYSTEM, nutzer, [SCHEMA],
    { maxTokens: 2000, model: MODELL, timeoutMs: 45000 });

  const auf = (r.aufrufe || []).find((a) => a.name === "angebot_inhalt");
  if (!auf) throw new Error("Kein Angebotstext zurückgekommen");
  const w = saeubern(auf.input || {});
  if (w.vorteile.length < 3) throw new Error("Zu wenige Nutzenpunkte zurückgekommen");
  if (w.posten_text.length < 80) throw new Error("Leistungsbeschreibung zu dünn");
  return w;
}

module.exports = { schreiben, saeubern, SYSTEM, MODELL };
