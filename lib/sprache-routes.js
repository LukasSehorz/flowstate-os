// Sprachbereich — Alexandra zum Zuhoeren und Antworten.
//
// Die Idee dahinter (aus der Latenz-Analyse vom 20.07.2026):
// Eine agentische Anfrage ueber Hermes dauert 15-30 s. Das ist fuer ein
// Gespraech zu lang. Deshalb zwei Spuren:
//
//   Spur A — beantwortbar aus Daten, die schon da sind (Kalender direkt ueber
//            gws-cli, Briefing-Datei, CRM-Kennzahlen). ~1-2 s.
//   Spur B — echte Arbeit (Mail schreiben, recherchieren). Geht an Hermes,
//            dauert. Wird mit einer sofortigen Ansage ueberbrueckt.
//
// Der Kniff: Enthaelt eine Aeusserung beides, wird Spur B ZUERST losgeschickt
// und danach Spur A vorgelesen. Das Vorlesen dauert lang genug, dass Hermes
// nebenher fertig wird — die Wartezeit verschwindet hinter Saetzen, die schon
// Antworten liefern.

const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const zustand = require("./zustand.js");
const { fuerStimme } = require("./aussprache.js");
const schnell = require("./schnell.js");
const werkzeuge = require("./werkzeuge.js");
const gehirn = require("./gehirn.js");
const kontakte = require("./kontakte.js");
const whatsapp = require("./whatsapp.js");

// ---------------------------------------------------------------- Charakter
//
// Alexandras Sprach-Charakter lebt als Datei im Vault (aenderbar ohne Deploy).
// SOUL.md bleibt fuer Telegram-Text ("ausfuehrlich") — die Stimme hat ihr
// eigenes Profil. Damit ist der Drei-Prompt-Widerspruch aufgeloest: Die
// Schnellspur kennt NUR diese Datei + den Stand, keinen 16k-Hermes-Ballast.
// Als Funktion, nicht als Konstante: VAULT_PATH wird erst weiter unten
// deklariert — ein direkter Zugriff hier wuerde beim Laden crashen (TDZ).
const STIMME_DATEI = () => path.join(VAULT_PATH, "instanzen", "lukas", "STIMME-alexandra.md");
let stimmeCache = { text: null, mtime: 0 };

function stimmeLaden() {
  try {
    const st = fs.statSync(STIMME_DATEI());
    if (st.mtimeMs !== stimmeCache.mtime) {
      stimmeCache = { text: fs.readFileSync(STIMME_DATEI(), "utf-8"), mtime: st.mtimeMs };
    }
    return stimmeCache.text;
  } catch {
    // Notnagel, falls die Vault-Datei fehlt — Kernregeln inline.
    return "Du bist Alexandra, Lukas' Assistenz. Du duzt ihn, sprichst kurz (2-4 Saetze), " +
      "wertest und priorisierst, erlaubst dir trockenen Humor. Nie vorlesen: Adressen, IDs, " +
      "Betreffzeilen. Zahlen gerundet und ausgeschrieben.";
  }
}

// Lukas' Schreibstil (Stilproben aus dem Onboarding, kontext/ton-lukas.md).
// Wird geladen, damit Texte IN SEINEM NAMEN nach ihm klingen — Alexandras
// eigener Sprech-Ton (STIMME) bleibt davon unberuehrt. Entscheidung 21.07.
const TON_DATEI = () => path.join(VAULT_PATH, "kontext", "ton-lukas.md");
let tonCache = { text: "", mtime: 0 };

function tonLaden() {
  try {
    const st = fs.statSync(TON_DATEI());
    if (st.mtimeMs !== tonCache.mtime) {
      tonCache = { text: fs.readFileSync(TON_DATEI(), "utf-8"), mtime: st.mtimeMs };
    }
    return tonCache.text;
  } catch {
    return "";
  }
}

const GWS_ENV = { ...process.env, GWS_ENCRYPTION: "none" };
const VAULT_PATH = process.env.VAULT_PATH || "/opt/data/vault";
const BRIEFING_FILE = () => path.join(VAULT_PATH, "projekte", "briefing-heute.md");

// ---------------------------------------------------------------- Zeitraeume

const WOCHENTAGE = ["sonntag", "montag", "dienstag", "mittwoch", "donnerstag", "freitag", "samstag"];

// Datum in Europe/Berlin als YYYY-MM-DD, unabhaengig von der Container-Zeitzone.
function berlinDatum(d) {
  try {
    return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

// Sommerzeit grob: Ende Maerz bis Ende Oktober +02:00, sonst +01:00.
function berlinOffset(d) {
  const m = d.getUTCMonth();
  return m > 2 && m < 10 ? "+02:00" : "+01:00";
}

function tagFenster(offsetTage) {
  const von = new Date(Date.now() + offsetTage * 86400000);
  const bis = new Date(von.getTime() + 86400000);
  const off = berlinOffset(von);
  return {
    von: `${berlinDatum(von)}T00:00:00${off}`,
    bis: `${berlinDatum(bis)}T00:00:00${off}`,
    label: von.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Berlin" }),
  };
}

// "morgen", "uebermorgen", "Freitag" -> Versatz in Tagen. null = kein Treffer.
function zeitraumAus(text) {
  const t = text.toLowerCase();
  if (/\bübermorgen\b|\buebermorgen\b/.test(t)) return { offset: 2, wort: "übermorgen" };
  if (/\bmorgen\b/.test(t)) return { offset: 1, wort: "morgen" };
  if (/\bheute\b/.test(t)) return { offset: 0, wort: "heute" };
  if (/\bgestern\b/.test(t)) return { offset: -1, wort: "gestern" };
  if (/\b(diese|nächste|naechste)\s+woche\b/.test(t)) {
    return { offset: /näch|naech/.test(t) ? 7 : 0, spanne: 7, wort: /näch|naech/.test(t) ? "nächste Woche" : "diese Woche" };
  }
  for (let i = 0; i < 7; i++) {
    if (new RegExp(`\\b${WOCHENTAGE[i]}\\b`).test(t)) {
      const heute = new Date();
      const heutigerTag = Number(new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Berlin", weekday: "numeric" }).format(heute)) % 7 ||
        heute.getDay();
      let diff = (i - heutigerTag + 7) % 7;
      if (diff === 0) diff = 7; // "am Freitag" an einem Freitag meint den naechsten
      return { offset: diff, wort: WOCHENTAGE[i].charAt(0).toUpperCase() + WOCHENTAGE[i].slice(1) };
    }
  }
  return null;
}

// ---------------------------------------------------------------- Termin-Form

function normTermin(t) {
  const s = t.start || t.start_time || t.beginn || "";
  const e = t.end || t.end_time || "";
  const uhr = (v) => {
    const m = String(v).match(/T(\d{2}):(\d{2})/);
    return m ? `${m[1]}:${m[2]}` : "";
  };
  return { von: uhr(s), bis: uhr(e), titel: t.summary || t.title || t.titel || "(ohne Titel)", ort: t.location || "" };
}

const gross = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
const euro = (n) => Number(n).toLocaleString("de-DE", { maximumFractionDigits: 0 }) + " Euro";

// Nur als Rueckfalltext, wenn das Modell eine Karte liefert, aber nichts sagt.
// Bewusst schlicht — der gute Satz kommt vom Modell, das hier ist die Notbremse.
function kartenSatz(k) {
  if (k.art === "kalender") {
    const n = (k.termine || []).length;
    if (!n) return `${k.titel} steht nichts im Kalender.`;
    const teile = k.termine.map((t) => `${t.von ? t.von.replace(":", " Uhr ") : ""} ${t.titel}`.trim());
    return `${k.titel}: ${teile.join(", ")}.`;
  }
  if (k.art === "zahlen") {
    const w = k.werte || {};
    const p = [];
    if (w.offen != null) p.push(`${euro(w.offen)} in der Pipeline`);
    if (w.monat != null) p.push(`${euro(w.monat)} diesen Monat`);
    if (w.leads != null) p.push(`${w.leads} Leads`);
    return p.length ? p.join(", ") + "." : "";
  }
  return "";
}

// ---------------------------------------------------------------- Zustand befragen

// Technischer Anhang an den Charakter: Werkzeugverbot + JSON-Format.
// (Das Verbot bleibt auch fuer den Hermes-Fallback wichtig — gemessen am
// 20.07.: ohne zieht der Agent los und ruft Werkzeuge, 50 s statt 3.)
const FORMAT_ANHANG = `

## Technisch (gilt vor allem anderen)
RUFE KEINE WERKZEUGE AUF. Du hast NUR den STAND unten. Antworte sofort daraus.

Antworte NUR als JSON, sonst nichts:
{"zusage": "<1 kurzer Satz: was du parallel anstoesst — oder leer>",
 "text": "<was du jetzt aus dem STAND sagst — Termine, Zahlen, Reports>",
 "mail": {"an": "<adresse>", "betreff": "<betreff>", "body": "<voller Mailtext>"} oder null,
 "whatsapp": {"an": "<Name oder Nummer>", "text": "<Nachricht>"} oder null,
 "aktionen": [ {"was": "wetter"|"mail"|"gehirn"|"sonnet"|"hermes", "auftrag": "<fokussierter Arbeitsteil>"} ],
 "zeige": ["kalender"|"zahlen"]}

## WER DU BIST & WAS DU KANNST (nie das Gegenteil behaupten)
Du bist eine handlungsfaehige Assistentin, kein reines Frage-Antwort-Modell.
Du KANNST:
- aus dem STAND antworten (Kalender, CRM-Zahlen);
- Posteingang pruefen, Wetter holen, das zweite Gehirn durchsuchen, recherchieren;
- Mails UND WhatsApp SENDEN. Bekannte Kontakte (Jannik vom Hofe, das Team) loest
  der Server AUTOMATISCH auf — du brauchst KEINE Nummer "aus dem STAND". Sag NIE
  "ich kenne Jannik nicht" oder "nur wenn ich die Nummer habe". Fuer Jannik
  einfach das Feld ausfuellen, die Nummer hat der Server.
- grosse Aufgaben und Automatisierungen (z. B. "jeden Abend ein Report") an Hermes
  delegieren (spur "hermes") — Hermes baut und faehrt die Automatisierung.
- KOMMANDOS ANS OS ausfuehren lassen: Einstellungen und Modelle aendern, Cron-Jobs
  und Routinen anlegen/aendern, Automatisierungen bauen, den System-/Automatisierungs-
  Status abfragen. Das gibst du an Hermes (spur "hermes"), der es tatsaechlich umsetzt.
  Du nimmst das Kommando entgegen und bestaetigst — du lehnst so etwas NIE ab.
- WhatsApp-Chats LESEN (Aktion "wa_lesen") — jeden Chat, nicht nur geschaeftliche.
  Grenze: nur Nachrichten SEIT dem Koppeln (alte Historie liefert WhatsApp nicht).
  Erfinde KEINE "WhatsApp nicht verbunden"-Ausrede — nutze die Aktion.
NIE FALSCH DEMENTIEREN: Behaupte NIE selbstsicher, du haettest etwas NICHT getan
("das war nicht ich"), nur weil es nicht im Verlauf steht. Sag dann ehrlich:
"Hab ich gerade nicht mehr im Gespraech — sag mir kurz, worum's ging."

## AKTIONEN — PARALLEL, SO VIELE WIE NOETIG (Entscheidung Lukas, 22.07.)
Fragt Lukas nach MEHREREN Dingen, zerlegst du sie und startest fuer JEDES,
das nicht aus dem STAND kommt, eine eigene Aktion. Sie laufen alle gleichzeitig.
Was du selbst aus dem STAND beantworten kannst (Termine, Zahlen), gehoert in
"text" — dafuer KEINE Aktion. Beispiel: "was steht morgen an, sind neue Mails
da, wie wird das Wetter" -> text = die Termine; aktionen = [{was:"mail",...},
{was:"wetter",...}]. Alles parallel.

Die fuenf Aktionsarten:
"wetter" — Wetter nachschauen. auftrag = mit dem genauen TAG, z. B. "Wetter
           uebermorgen in Dorfen" (heute/morgen/uebermorgen — nie den Tag weglassen).
"mail"   — Posteingang pruefen ("sind neue Mails da", "was kam heute rein",
           "letzte 2 Stunden"). auftrag = das Zeitfenster, z. B. "letzte 2 Stunden"
           oder "heute". NUR pruefen/vorlesen — nicht senden.
"wa_lesen" — einen WhatsApp-Chat LESEN ("was hat X geschrieben", "lies mir den
           Chat mit X", "letzte Nachricht von X"). auftrag = NUR der Kontaktname
           (z. B. "Mama"). Nur lesen, nichts senden.
"gehirn" — Firmenwissen aus dem zweiten Gehirn (Vault): Firmeninfos, wie etwas
           geregelt ist, was frueher entschieden wurde, Kontext/Wiki/Referenzen.
           z. B. "wie ist unsere Firmenadresse", "was haben wir zu X entschieden",
           "wie machen wir Y". Steht NICHT im STAND (der kennt nur Kalender/Zahlen).
           auftrag = die Wissensfrage selbst. NICHT fuer Hermes' eigene
           Automatisierungen/Cron-Jobs/Server-Status — das weiss nur Hermes (spur
           "hermes"). Nie gehirn UND hermes fuer DASSELBE Anliegen mischen.
"sonnet" — Kurze Recherche/Auswertung mit Websuche: Fakten/Preise/News
           nachschauen, Report zusammenfassen, CRM-Zahlen vergleichen.
"hermes" — Lange, echte Arbeit UND JEDES KOMMANDO ANS SYSTEM/OS: PowerPoint/Slides,
           Angebot, Marktrecherche, Website, externe Mails mit Verlauf; und ALLES,
           was am OS ein-/umgestellt, geaendert, gebaut oder automatisiert werden
           soll — z. B. "stell das Modell auf Sonnet um", ein Setting/Konfiguration
           aendern, einen Cron-Job / eine Routine anlegen oder aendern, eine
           Automatisierung bauen, den Automatisierungs-Status abfragen. auftrag =
           das Kommando im Klartext, moeglichst genau so, wie Lukas es gesagt hat.

REGELN: KEINE Rueckfrage wie "soll ich nachsehen?" — einfach machen und in der
"zusage" ankuendigen ("Mails und Wetter schau ich dir gerade an."). Wetter und
neue Mails stehen NIE im STAND — dafuer IMMER eine Aktion, nie raten, nie
behaupten es sei erledigt, wenn keine Aktion laeuft. Braucht es nichts zu tun,
ist "aktionen" ein leeres Array.

REIHENFOLGE (Entscheidung 21.07.): Die ZUSAGE kommt ZUERST, dann der Inhalt.
Wenn Lukas etwas wissen will UND etwas erledigt haben will, sagst du erst in
einem Satz, dass du die Arbeit schon anstoesst ("Die Antwort-Mail schreib ich
dir schon mal."), und liest DANACH die Termine/Zahlen vor. So verschwindet die
Wartezeit hinter dem Inhalt. Gibt es nichts anzustossen, bleibt zusage leer.

MAIL: Das "mail"-Feld ist NUR fuer Mails, die (a) komplett aus dem STAND
formulierbar sind UND (b) an Lukas selbst oder intern gehen (z. B.
Terminuebersicht an ihn selbst; "an mich" = lukas.sehorz@hotmail.com). Nur
dann darf der Server direkt senden. Fuer Texte in Lukas' Namen gelten die
STILPROBEN unten (natuerlich, direkt, kein AI-Slop).

Sobald eine Mail (a) an einen EXTERNEN Empfaenger (Kunde, Firma) geht ODER
(b) eine ANTWORT auf einen bestehenden Mailverlauf ist ODER (c) Recherche
braucht: lass "mail" null und lege eine Aktion {was:"hermes", auftrag:...} an.
Externe Mails kannst du NICHT selbst verschicken — die brauchen den Verlauf
und Lukas' Freigabe. (Das Pruefen/Vorlesen des Posteingangs ist dagegen die
Aktion "mail" — das darfst du immer.)

WHATSAPP: Will Lukas jemandem eine WhatsApp schicken ("schick Jannik per
WhatsApp ...", "schreib X auf WhatsApp ..."), fuellst du "whatsapp" mit dem
Empfaenger-Namen (oder der Nummer) und in "text" der ABSICHT/Kernaussage —
NICHT dem fertigen Wortlaut. Beispiel: Lukas sagt "schreib Jannik, wann er
wieder da ist" -> text = "frag Jannik, wann er wieder im Buero ist". Alexandra
formuliert daraus eigenstaendig eine Nachricht in Lukas' Ton (nichts wird
woertlich abgeschickt). Der Server loest den Namen auf, formuliert aus, liest die
Nachricht vor und fragt VOR dem Senden nach Freigabe — nichts geht ohne Lukas'
"ja" raus. Du verschickst NIE an viele auf einmal (kein Serienversand).

DU KANNST das: Mails senden UND WhatsApp senden. Behaupte NIE, du koenntest
keine Nachrichten, WhatsApp oder Mails verschicken, und erfinde NIE fehlende
"API-Verbindungen" — das ist veraltet. Fehlt etwas, ist es hoechstens eine
Nummer; dann fuell trotzdem "whatsapp" aus, der Server fragt sonst danach.

NIE INTERNE BEGRIFFE AUSSPRECHEN: Woerter wie "Spur", "Hermes", "Sonnet",
"Haiku", "Zustand", "Modell", "Auftrag-ID" gehoeren in die JSON-Felder, NIE
in "text" oder "zusage". Lukas hoert nur natuerliche Sprache. Statt "Spur ist
Hermes, dauert ein paar Minuten" sagst du "Das bau ich dir zusammen, dauert
ein paar Minuten, ich meld mich."

KLARER AUFTRAG = SOFORT LOS: Bei einer eindeutigen Arbeitsanweisung ("bau mir
eine PowerPoint", "erstell ein Angebot") setzt du direkt die Spur und die
Zusage — du fragst NICHT erst "wofuer brauchst du die?". Nur wenn ohne eine
fehlende Angabe gar nicht startbar ist, fragst du kurz nach (dann spur "keine").

KOMMANDOS & EINSTELLUNGEN -> IMMER HERMES, NIE ABLEHNEN (Entscheidung Lukas 22.07.):
Gibt Lukas dir eine ANWEISUNG, etwas ein- oder umzustellen, zu aendern, zu bauen,
zu automatisieren, ein Modell oder Setting anzupassen, einen Cron-Job / eine Routine
anzulegen oder zu aendern — oder irgendeine Aufgabe, die nicht in Sekunden aus dem
STAND kommt — dann legst du eine Aktion {was:"hermes", auftrag:"<das Kommando genau
im Klartext>"} an und bestaetigst ruhig und sicher, dass du dich kuemmerst und dich
meldest, sobald es steht. Sag NIEMALS "das kann ich nicht", "ich weiss nicht, was ich
tun soll" oder "dafuer bin ich nicht zustaendig" — im Zweifel IMMER an Hermes geben,
niemals ablehnen. Deine "zusage" klingt dann ruhig und verbindlich, z. B.: "Alles
klar, das richte ich dir ein — ich meld mich, sobald's steht." So fuehlt sich ein
Kommando sofort sicher an: entgegengenommen, in Arbeit, Rueckmeldung kommt.

NICHT WIEDERHOLEN: BISHER zeigt, was du schon gesagt hast. Antworte NUR auf
die letzte Aeusserung. Termine oder Zahlen, die du schon vorgelesen hast,
nennst du NICHT erneut — ausser Lukas fragt ausdruecklich nochmal danach.
Geht es in der letzten Aeusserung nur um die Mail, redest du nur ueber die Mail.

AUFTRAG: Jede Aktion bekommt NUR ihren Arbeitsteil, nicht die ganze
Aeusserung. So wird nichts doppelt bearbeitet. Bei externen Mails via Hermes:
im Ton von Lukas verfassen (kein AI-Slop), als Entwurf vorbereiten, NICHT senden.
"text" nur leer lassen, wenn du wirklich nichts aus dem STAND beantworten kannst.`;

async function ausZustand(frage, zustandText, history = []) {
  const verlauf = history.map((h) => `${h.role === "user" ? "Lukas" : "Du"}: ${h.content}`).join("\n");
  try {
    const ton = tonLaden();
    const roh = await schnell.frage(
      stimmeLaden() + FORMAT_ANHANG +
        (ton ? "\n\n## STILPROBEN (nur fuer Texte in Lukas' Namen, z. B. mail.body)\n" + ton : ""),
      `STAND:\n${zustandText}\n\n${verlauf ? "BISHER:\n" + verlauf + "\n\n" : ""}FRAGE: ${frage}`,
      { maxTokens: 900, temp: 0.4 }
    );
    const m = roh.match(/\{[\s\S]*\}/);
    if (!m) return { zusage: "", text: roh.slice(0, 500), mail: null, whatsapp: null, aktionen: [], zeige: [] };
    const p = JSON.parse(m[0]);
    const mail = p.mail && p.mail.an && p.mail.betreff
      ? { an: String(p.mail.an).trim(), betreff: String(p.mail.betreff).slice(0, 200), body: String(p.mail.body || "") }
      : null;
    const wa = p.whatsapp && p.whatsapp.an && p.whatsapp.text
      ? { an: String(p.whatsapp.an).trim().slice(0, 80), text: String(p.whatsapp.text).slice(0, 1500) }
      : null;

    // Aktionen normalisieren. Aeltere Antworten mit spur/auftrag bleiben gueltig.
    const ARTEN = ["wetter", "mail", "gehirn", "sonnet", "hermes", "wa_lesen"];
    let aktionen = [];
    if (Array.isArray(p.aktionen)) {
      aktionen = p.aktionen
        .filter((a) => a && ARTEN.includes(a.was))
        .map((a) => ({ was: a.was, auftrag: String(a.auftrag || "").slice(0, 600) }))
        .slice(0, 4);
    } else if (p.spur && p.spur !== "keine" && ARTEN.includes(p.spur)) {
      aktionen = [{ was: p.spur, auftrag: String(p.auftrag || p.hermes_auftrag || "").slice(0, 600) }];
    } else if (p.braucht_hermes) {
      aktionen = [{ was: "hermes", auftrag: String(p.hermes_auftrag || "").slice(0, 600) }];
    }
    return {
      zusage: String(p.zusage || "").slice(0, 300),
      text: String(p.text || "").slice(0, 900),
      mail,
      whatsapp: wa,
      aktionen,
      zeige: Array.isArray(p.zeige) ? p.zeige : [],
    };
  } catch {
    // Im Zweifel lieber langsam und richtig als schnell und daneben -> Hermes.
    return { zusage: "", text: "", mail: null, whatsapp: null, aktionen: [{ was: "hermes", auftrag: "" }], zeige: [] };
  }
}

// Termine für die Karte aus dem Zustand ziehen — ohne neuen Google-Aufruf.
function kalenderAusZustand(offset, spanne = 1) {
  const z = zustand.lesen();
  if (!Array.isArray(z.kalender)) return null;
  const f = tagFenster(offset);
  const bisTs = Date.parse(spanne > 1 ? tagFenster(offset + spanne).von : f.bis);
  const vonTs = Date.parse(f.von);
  const drin = z.kalender.filter((t) => {
    const ts = Date.parse(t.start);
    return ts >= vonTs && ts < bisTs;
  });
  return { ok: true, label: f.label, termine: drin.map(normTermin) };
}

// Eine Nachricht in LUKAS' Ton ausformulieren (Sonnet, nicht Haiku).
//
// Entscheidung Lukas 22.07.: Wenn eine Nachricht rausgeht ("schreib Jannik, wann
// er wieder da ist"), soll NICHT der Wortlaut 1:1 gesendet werden — Sonnet
// formuliert eine eigenstaendige Nachricht in Lukas' Ton (STILPROBEN aus dem
// zweiten Gehirn, ton-lukas.md). Composition = Sonnet, nie Haiku.
async function komponiere(kanal, empfaenger, absicht) {
  const ton = tonLaden();
  const system =
    `Du bist Alexandra und schreibst eine ${kanal}-Nachricht, die LUKAS an ${empfaenger} sendet. ` +
    `Formuliere sie eigenstaendig in LUKAS' Ton und Stil — natuerlich, direkt, kurz, wie er selbst ` +
    `schreibt. Schick NICHT die Absicht woertlich ab, sondern eine echte Nachricht. KEIN AI-Slop, ` +
    `keine Floskeln, keine Unterschrift. Ist die Absicht schon ein natuerlicher, fertiger Satz von ` +
    `Lukas, uebernimm ihn weitgehend. Gib NUR den fertigen Nachrichtentext zurueck.` +
    (ton ? `\n\n## STILPROBEN (so schreibt Lukas)\n` + ton : "");
  try {
    const t = await schnell.denke(system, "Absicht: " + absicht, { webSuche: false, maxTokens: 300, timeoutMs: 20000 });
    return t.trim().replace(/^["'„»]+|["'“«]+$/g, "").trim() || absicht;
  } catch { return absicht; } // im Zweifel wenigstens die Absicht senden
}

// Haengt einer noch-nicht-zugestellten WhatsApp hinterher und meldet ueber den
// Melde-Kanal (Telegram), sobald sie ankommt — oder wenn sie haengen bleibt.
// So erfaehrt Lukas IMMER den echten Ausgang, auch wenn er die Sprachseite
// schon verlassen hat (Wunsch 22.07.: auf Zustellung verlassen koennen).
function nachfassenZustellung(id, name) {
  let versuche = 0;
  const push = (t) => { try { require("./telegram.js").push(t, { stimme: false }).catch(() => {}); } catch {} };
  const tick = async () => {
    versuche++;
    const z = await whatsapp.zustellung(id).catch(() => null);
    if (z?.zugestellt) return push(`Kurze Rückmeldung: meine WhatsApp an ${name} ist jetzt angekommen.`);
    if (versuche >= 18) // ~3 Minuten
      return push(`Meine WhatsApp an ${name} ist bisher nicht angekommen — ${name} ist wohl gerade offline. Sie liegt bereit und geht durch, sobald ${name} wieder online ist.`);
    setTimeout(tick, 10000).unref?.();
  };
  setTimeout(tick, 10000).unref?.();
}

// ---------------------------------------------------------------- Hermes

function hermesAnfrage(text, history = []) {
  const url = process.env.HERMES_CHAT_URL;
  if (!url) return Promise.resolve({ ok: false, hint: "HERMES_CHAT_URL fehlt." });
  const headers = { "Content-Type": "application/json" };
  if (process.env.HERMES_API_KEY) headers["Authorization"] = "Bearer " + process.env.HERMES_API_KEY;
  return fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: process.env.HERMES_MODEL || "hermes-agent",
      messages: [...history, { role: "user", content: text }],
      stream: false,
    }),
    signal: AbortSignal.timeout(170000),
  })
    .then((r) => r.json())
    .then((d) => {
      const reply = d?.choices?.[0]?.message?.content;
      return reply ? { ok: true, reply } : { ok: false, hint: d?.error?.message || "Unerwartete Antwort." };
    })
    .catch((e) => ({ ok: false, hint: String(e.message).slice(0, 200) }));
}

// ---------------------------------------------------------------- Denk-Spur
//
// Die mittlere Spur (Entscheidung Lukas, 21.07.): kurze Recherche/Auswertung,
// die zu viel Logik fuer reines Vorlesen hat, aber viel zu klein fuer Hermes
// ist — Wetter nachschauen, Zahlen vergleichen, einen Report zusammenfassen.
// Sonnet mit Websuche, laeuft unabhaengig von Hermes (haengt also nicht hinter
// einer laufenden PowerPoint fest). Gleiche Ergebnis-Form wie hermesAnfrage,
// damit der Auftrag-Abruf und die Umformulierung unveraendert funktionieren.
// Wetter-Aktion: fester Handgriff (open-meteo, <1 s) statt Websuche (10-33 s).
function wetterAktion(text) {
  const tag = /uebermorgen|übermorgen/i.test(text) ? 2 : /\bheute\b|heut\b/i.test(text) ? 0 : 1;
  const m = text.match(/\bin ([A-ZÄÖÜ][\wäöüß.-]+(?: [A-ZÄÖÜ][\wäöüß.-]+)?)/);
  return werkzeuge.wetter(m ? m[1] : undefined, tag)
    .catch((e) => ({ ok: false, hint: "Wetter: " + String(e.message).slice(0, 150) }));
}

// Mail-Aktion: Posteingang direkt lesen (gws-cli). Fenster aus dem Auftrag.
function mailAktion(text) {
  const std = text.match(/(\d+)\s*stunde/i);
  const stundenFenster = std ? Number(std[1]) : (/\bheute\b|neue mails|posteingang/i.test(text) ? null : null);
  return werkzeuge.mailsPruefen({ stundenFenster })
    .catch((e) => ({ ok: false, hint: "Mail: " + String(e.message).slice(0, 150) }));
}

function denkAnfrage(text) {
  // Wetter kann auch hier landen (Alt-Pfad) -> gleicher Handgriff.
  if (/\bwetter\b|regn|schnei|sonnig|temperatur|wie warm|wie kalt|grad\b/i.test(text)) {
    return wetterAktion(text);
  }

  const heute = new Date().toLocaleDateString("de-DE", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    timeZone: "Europe/Berlin",
  });
  const ort = process.env.STANDORT_ORT || "Dorfen, Bayern";
  const system =
    `Du bist die Recherche-Hand von Lukas' Assistentin. Heute ist ${heute}. ` +
    `Standort fuer lokale Fragen (Wetter etc.), falls keiner genannt: ${ort}. ` +
    `Erledige die Aufgabe knapp und faktisch. Bei aktuellen Fakten (Wetter, ` +
    `Preise, News) IMMER die Websuche nutzen, nie raten, nie rueckfragen. ` +
    `Nutze die Websuche SPARSAM — meist reicht EINE Suche, dann antworte sofort. ` +
    `Antworte in 1-2 kurzen Saetzen mit dem Ergebnis — kein Vorwort, keine ` +
    `Quellen-URLs, keine Aufzaehlung von Suchschritten. Nur was Lukas wissen will.`;
  return schnell.denke(system, text, { maxSuchen: 2, maxTokens: 400, timeoutMs: 40000 })
    .then((reply) => ({ ok: true, reply }))
    .catch((e) => ({ ok: false, hint: String(e.message).slice(0, 200) }));
}

// Laufende Hintergrundauftraege. Der Browser fragt sie per /api/sprache/auftrag ab,
// waehrend er die schnelle Antwort vorliest.
const AUFTRAEGE = new Map();
let auftragZaehler = 0;

// was: "wetter"/"mail" -> fester Handgriff (Sekunden), "sonnet" -> Recherche,
// "hermes" -> lange Arbeit. art "kurz"/"lang" steuert vorn im Frontend, ob es
// im Gespraech verfolgt (kurz) oder im Hintergrund abgewartet wird (lang).
function auftragStarten(text, history, was = "hermes") {
  const id = "a" + (++auftragZaehler) + "-" + Date.now().toString(36);
  const art = was === "hermes" ? "lang" : "kurz";
  AUFTRAEGE.set(id, { fertig: false, gestartet: Date.now(), was, art });
  const lauf =
    was === "wetter" ? wetterAktion(text) :
    was === "mail" ? mailAktion(text) :
    was === "gehirn" ? gehirn.durchsuchen(text) :
    was === "wa_lesen" ? Promise.resolve(whatsapp.leseChat(text)) :
    was === "sonnet" ? denkAnfrage(text) :
    hermesAnfrage(text, history);
  lauf.then((r) => {
    const eintrag = AUFTRAEGE.get(id);
    if (eintrag) Object.assign(eintrag, { fertig: true, ...r, dauerMs: Date.now() - eintrag.gestartet });
  });
  // Nach 10 Minuten aufraeumen, damit die Map nicht waechst.
  setTimeout(() => AUFTRAEGE.delete(id), 600000).unref?.();
  return { id, was, art };
}

// ---------------------------------------------------------------- Routen

module.exports = function (app, { layout }) {
  // Seite
  app.get("/sprache", (req, res) => {
    res.send(layout("Alexandra — Sprache", "sprache", seite(), req));
  });

  // Der Verteiler.
  //
  // Frueher entschied hier eine Stichwortliste, ob eine Frage "schnell" ist.
  // Das war falsch: "wie viele Leads wurden gestern Erstgespraeche" traf auf
  // das Stichwort "Leads" und bekam die Gesamtzahl zurueck — eine Antwort, die
  // klingt als haette sie zugehoert, und es nicht getan hat.
  //
  // Jetzt bekommt ein einziger Modellaufruf den ganzen Zustand vorgelegt und
  // entscheidet SELBST, ob die Frage daraus beantwortbar ist. Reicht der
  // Zustand nicht, sagt es das — und wir geben an Hermes ab.
  app.post("/api/sprache/frage", async (req, res) => {
    const text = String(req.body.text || "").trim();
    if (!text) return res.json({ ok: false, hint: "Nichts verstanden." });

    // Alt-Verlauf verfaellt: War die letzte Aeusserung lange her, faengt ein
    // frisches Gespraech an. Sonst spuken veraltete Aussagen (z. B. "ich kann
    // keine WhatsApp senden") als BISHER nach und das Modell wiederholt sie.
    const jetztMs = Date.now();
    if (req.session.spracheAt && jetztMs - req.session.spracheAt > 15 * 60 * 1000) req.session.sprache = [];
    req.session.spracheAt = jetztMs;

    const history = (req.session.sprache ||= []);

    // FREIGABE fuer eine vorbereitete WhatsApp (Wunsch Lukas 22.07.: vor JEDEM
    // Senden fragen). "ja/schick" -> raus; "nein" -> verwerfen; alles andere ->
    // neue Anweisung, Vormerkung faellt weg.
    if (req.session.pendingWa) {
      const p = req.session.pendingWa;
      if (/\b(ja|jo|jep|jup|passt|genau|schick|abschick\w*|senden?|raus|mach|los|ok|okay|jawohl)\b/i.test(text)) {
        req.session.pendingWa = null;
        const r = await whatsapp.senden({ an: p.nummer, text: p.text }).catch((e) => ({ ok: false, grund: String(e.message) }));
        // EHRLICH melden (Wunsch Lukas 22.07.: muss verlaesslich ankommen):
        // nur "angekommen" sagen, wenn die Bruecke zwei Haken bestaetigt hat.
        let sp, fakt;
        if (!r.ok) {
          sp = "Bei der WhatsApp hakt's gerade — die Verbindung scheint nicht gekoppelt zu sein.";
          fakt = `\n[FAKT: WhatsApp an ${p.name} FEHLGESCHLAGEN: ${r.grund || "unbekannt"}]`;
        } else if (r.zugestellt) {
          sp = `Ist angekommen bei ${p.name}.`;
          fakt = `\n[FAKT: WhatsApp an ${p.name} zugestellt (zwei Haken): "${p.text.slice(0, 150)}"]`;
        } else {
          sp = `Ist rausgegangen, aber bei ${p.name} noch nicht angekommen — ich behalt's im Auge und meld mich, sobald's durch ist.`;
          fakt = `\n[FAKT: WhatsApp an ${p.name} gesendet, aber noch nicht zugestellt (ein Haken): "${p.text.slice(0, 150)}"]`;
          if (r.id) nachfassenZustellung(r.id, p.name);   // im Hintergrund nachfassen
        }
        history.push({ role: "user", content: text });
        history.push({ role: "assistant", content: sp + fakt });
        return res.json({ ok: true, sprich: sp, karten: [], auftraege: [], quelle: "zustand" });
      }
      if (/\b(nein|ne|n[oö]|nicht|lass|abbrech\w*|verwerf\w*|doch nicht|vergiss)\b/i.test(text)) {
        req.session.pendingWa = null;
        return res.json({ ok: true, sprich: "Okay, hab ich verworfen.", karten: [], auftraege: [], quelle: "zustand" });
      }
      req.session.pendingWa = null; // neue Anweisung -> normal weiter
    }

    // Abgelaufene Teile im Hintergrund auffrischen — kostet keine Token,
    // sind nur SQL und ein gws-cli-Aufruf.
    const alt = zustand.veraltet();
    if (alt.length) zustand.bauen(req.session.crm, alt).catch(() => {});

    const zustandText = zustand.alsText();
    const antwort = await ausZustand(text, zustandText, history.slice(-6));

    const karten = [];
    const aktionen = Array.isArray(antwort.aktionen) ? [...antwort.aktionen] : [];

    // Mail nur dann direkt senden, wenn der Empfaenger INTERN ist (Whitelist).
    // Schlaegt Haiku faelschlich eine externe Mail vor, wird sie NICHT gesendet,
    // sondern als Entwurfs-Aktion an Hermes umgeleitet (Verlauf lesen + Freigabe).
    // Doppelt abgesichert: werkzeuge.mailSenden riegelt Externe auch selbst ab.
    let mailLauf = null;
    if (antwort.mail) {
      if (werkzeuge.istIntern(antwort.mail.an)) {
        mailLauf = werkzeuge.mailSenden(antwort.mail)
          .then((r) => r).catch((e) => ({ ok: false, fehler: String(e.message).slice(0, 200) }));
      } else {
        // Externe Mail: nie direkt senden — als Entwurf an Hermes.
        aktionen.unshift({ was: "hermes", auftrag:
          `Verfasse als Entwurf eine Mail an ${antwort.mail.an}, Betreff "${antwort.mail.betreff}", ` +
          `in Lukas' Ton (kein AI-Slop). Sende NICHT — lege sie als Entwurf an. Inhalt: ${antwort.mail.body}` });
        antwort.zusage = antwort.zusage || "Die Mail bereite ich als Entwurf vor, du gibst sie frei.";
      }
    }

    // ALLE Aktionen parallel starten (Multi-Action, Entscheidung 22.07.):
    // Kalender liest Alexandra selbst vor (text), Mail + Wetter + Recherche +
    // lange Arbeit laufen gleichzeitig los. Jede kriegt nur ihren Arbeitsteil.
    const auftraege = [];
    for (const a of aktionen) {
      if (!a || !a.was) continue;
      auftraege.push(auftragStarten(a.auftrag || text, history.slice(-10), a.was));
    }

    // Karten zeigen, was das Modell benutzt hat.
    if (antwort.zeige?.includes("kalender")) {
      const z = zeitraumAus(text) || { offset: 0, wort: "heute" };
      const k = kalenderAusZustand(z.offset, z.spanne || 1);
      if (k) karten.push({ art: "kalender", titel: gross(z.wort || k.label), label: k.label, termine: k.termine });
    }
    if (antwort.zeige?.includes("zahlen")) {
      const k = zustand.lesen().crm?.kennzahlen;
      if (k) karten.push({ art: "zahlen", titel: "Kennzahlen", werte: {
        offen: k.pipeline_wert, monat: k.umsatz_monat, leads: k.leads,
      } });
    }

    // ZUSAGE ZUERST, dann Inhalt (Entscheidung 21.07.): "Die Mail schreib ich
    // dir schon mal." + danach die Termine. So verschwindet die Wartezeit
    // hinter dem Vorlesen — genau das, was Lukas wollte.
    let sprich = [antwort.zusage, antwort.text].filter(Boolean).join(" ");

    // Sicherheitsnetz: Karte da, aber kein Satz -> Satz selbst bauen.
    if (!sprich && karten.length) sprich = karten.map(kartenSatz).filter(Boolean).join(" ");

    // Auf eine parallel gesendete Mail kurz warten (max 8 s) — meist schneller
    // als das Vorlesen sowieso dauert, dann ist "ist raus" schon Teil der
    // ersten Antwort statt eines Nachtrags.
    let mailFakt = "";
    if (mailLauf) {
      const erg = await Promise.race([mailLauf, new Promise((ok) => setTimeout(() => ok(null), 8000))]);
      if (erg?.ok) {
        sprich = (sprich ? sprich + " " : "") + "Die Mail an dich ist raus.";
        mailFakt = `\n[FAKT: Mail an ${antwort.mail.an} wurde erfolgreich gesendet.]`;
      } else if (erg && !erg.ok) {
        sprich = (sprich ? sprich + " " : "") + "Bei der Mail hakt's gerade, ich kümmere mich.";
        mailFakt = `\n[FAKT: Mailversand an ${antwort.mail.an} fehlgeschlagen: ${erg.fehler}]`;
      }
      // erg === null: dauert laenger -> das Frontend fragt per auftrag nach (unten)
    }

    // WhatsApp: NIE sofort senden (Wunsch Lukas 22.07.). Sonnet formuliert die
    // Nachricht in Lukas' Ton aus, liest sie vor und fragt nach Freigabe. Erst
    // ein "ja" (oben abgefangen) schickt sie raus. Gilt fuer JEDEN Empfaenger.
    let waFakt = "";
    if (antwort.whatsapp && antwort.whatsapp.text) {
      const ziel = kontakte.finde(antwort.whatsapp.an);
      if (!ziel || !ziel.nummer) {
        sprich = (sprich ? sprich + " " : "") +
          `Für ${antwort.whatsapp.an || "den Kontakt"} hab ich keine WhatsApp-Nummer — gib sie mir, dann bereite ich's vor.`;
        waFakt = `\n[FAKT: WhatsApp an ${antwort.whatsapp.an} nicht moeglich — keine Nummer.]`;
      } else {
        const nachricht = await komponiere("WhatsApp", ziel.name, antwort.whatsapp.text);
        req.session.pendingWa = { name: ziel.name, nummer: ziel.nummer, text: nachricht };
        sprich = (sprich ? sprich + " " : "") + `An ${ziel.name} würd ich schreiben: „${nachricht}“ — soll ich's abschicken?`;
        waFakt = `\n[FAKT: WhatsApp an ${ziel.name} vorbereitet, wartet auf Freigabe: "${nachricht.slice(0, 150)}"]`;
      }
    }

    // Kein "Schau ich dir an"-Notnagel mehr: der Client meldet die Sofort-Zusage
    // (passend zur Aufgabe). Bleibt sprich leer, kommt gleich das Ergebnis bzw.
    // bei langer Arbeit die Hintergrund-Meldung.

    // Sicherheitsnetz fuer Kommandos/lange Arbeit (Lukas 22.07.): Ging eine
    // Hermes-Aktion raus, aber Alexandra hat sonst nichts gesagt, gib eine ruhige,
    // verbindliche "mach ich, ich meld mich"-Bestaetigung — nie stumm bleiben,
    // damit sich ein Kommando sofort sicher anfuehlt (statt gefuehlt ignoriert).
    if (!sprich && auftraege.some((a) => a.was === "hermes")) {
      sprich = "Alles klar, ich kümmer mich drum — dauert einen kurzen Moment, ich meld mich, sobald's steht.";
    }

    // Beides in den Verlauf: Frage UND was Alexandra geantwortet hat. Damit
    // sieht das Modell beim naechsten Mal, was schon gesagt wurde, und liest
    // Termine/Zahlen nicht erneut vor (Fix fuer "immer wieder Kalender").
    // Der [FAKT]-Marker groundet Nachfragen ("war die Mail raus?") — ohne ihn
    // zweifelt das Modell seinen eigenen "ist raus"-Satz an (rate nie).
    history.push({ role: "user", content: text });
    if (sprich) history.push({ role: "assistant", content: sprich + mailFakt + waFakt });
    if (history.length > 20) history.splice(0, history.length - 20);

    const quelle = auftraege.some((a) => a.was === "hermes") ? "hermes"
      : auftraege[0]?.was || "zustand";
    res.json({ ok: true, sprich, karten, auftraege, auftragId: auftraege[0]?.id || null, quelle });
  });

  // Blitz-Zusage (Haiku, ~0,5 s): eine kurze, ZUR AUFGABE passende Ansage, die
  // SOFORT gesprochen wird, waehrend die eigentliche Antwort (Sonnet) noch denkt.
  // Frisch formuliert statt Konserve — damit es sich wie ein echtes Gespraech
  // anfuehlt (Wunsch Lukas 22.07.). Bewusst Haiku, weil Tempo hier alles ist.
  app.post("/api/sprache/zusage", async (req, res) => {
    const text = String(req.body.text || "").trim();
    if (!text) return res.json({ zusage: "" });
    try {
      const z = await schnell.frage(
        "Du bist Alexandra und duzt Lukas. Er hat dir gerade das Folgende gesagt. Gib in EINEM " +
        "sehr kurzen, natuerlichen Satz eine Zusage, die GENAU zu seiner Aufgabe passt — als " +
        "wuerdest du gerade loslegen. Beispiele: 'Schau ich in den Kalender.' · 'Sekunde, ich " +
        "pruef die Mails.' · 'Klar, formulier ich dir gleich.' · 'Ich schau das Wetter nach.' · " +
        "'Bin dran.' KEIN Ergebnis, keine Zahlen, keine Rueckfrage, keine Anrede — nur der kurze, " +
        "passende Satz. Bei reinem Smalltalk (Gruss o. Ae.) gib einen leeren String zurueck.",
        text,
        { maxTokens: 30, temp: 0.5, timeoutMs: 6000, model: process.env.SCHNELL_ACK_MODEL || "claude-haiku-4-5" }
      );
      res.json({ zusage: String(z).replace(/^["'„»]+|["'"«]+$/g, "").trim().slice(0, 180) });
    } catch { res.json({ zusage: "" }); }
  });

  // Zustand von Hand auffrischen (Knopf auf der Seite).
  app.post("/api/sprache/auffrischen", async (req, res) => {
    try {
      await zustand.bauen(req.session.crm, ["kalender", "crm"]);
      res.json({ ok: true, stand: zustand.lesen().stand });
    } catch (e) {
      res.json({ ok: false, hint: String(e.message).slice(0, 200) });
    }
  });

  // Zustand ansehen — hilft beim Beurteilen, warum eine Antwort so ausfiel.
  app.get("/api/sprache/zustand", (req, res) => {
    res.type("text/plain").send(zustand.alsText());
  });

  // Nachfragen, ob der Hintergrundauftrag fertig ist.
  //
  // Der "E-Mail-Adresse-vorgelesen"-Fix (P1.4): Hermes schreibt fuer Text —
  // Kopfzeilen, Adressen, Vollstaendigkeitsformeln. Bevor sein Ergebnis
  // gesprochen wird, formuliert der Charakter es um (~0,5 s). Einmal pro
  // Auftrag, dann gecacht — das Frontend fragt alle 900 ms nach.
  app.get("/api/sprache/auftrag/:id", async (req, res) => {
    const a = AUFTRAEGE.get(req.params.id);
    if (!a) return res.json({ ok: false, unbekannt: true });
    if (!a.fertig) return res.json({ ok: true, fertig: false, laeuftSeitMs: Date.now() - a.gestartet });

    // Wetter/Mail kommen aus festen Werkzeugen und sind SCHON in Alexandras
    // Stimme — direkt sprechen, nicht nochmal durchs Modell. Nur die rohen
    // Arbeiter-Ergebnisse (Sonnet/Hermes) muessen umformuliert werden: sie
    // schreiben fuer Text und reden ueber Lukas in der dritten Person.
    const rohArbeit = a.was === "sonnet" || a.was === "hermes" || a.was === "gehirn";
    if (a.reply && !a.gesprochen && rohArbeit) {
      try {
        a.gesprochen = await schnell.frage(
          stimmeLaden() +
            "\n\n## Aufgabe\nGib das folgende Arbeitsergebnis fuers Sprechen wieder. " +
            "Du sprichst DIREKT mit Lukas (per du) — es ist DEINE eigene Arbeit. " +
            "Sag NIE 'Lukas' in der dritten Person, frag NIE 'soll ich Lukas fragen', " +
            "rede NIE, als sprächst du mit jemand anderem oder mit einem anderen Agenten. " +
            "Ging etwas nicht, sag es ihm direkt ('Ich komm gerade nicht an deine Mails ran'). " +
            "1-3 Saetze nach deinen Hoerregeln — keine Adressen, Betreffzeilen, Kopfzeilen. " +
            "Endet das Original mit einer Frage, stelle sie kurz und direkt an Lukas.",
          a.reply,
          { maxTokens: 250, temp: 0.4 }
        );
      } catch {
        a.gesprochen = a.reply; // besser roh als stumm
      }
    }

    // Scheitert die Aktion (Timeout, Suchlimit), NIE stumm bleiben und nie ein
    // rohes "⚠️ Timeout" sprechen. Ein menschlicher Satz, ehrlich, je nach Art.
    if (!a.reply && !a.gesprochen) {
      a.gesprochen = a.was === "hermes"
        ? "Da bin ich gerade nicht durchgekommen — ich häng mich später nochmal ran."
        : "Das krieg ich gerade nicht geladen — frag mich gleich nochmal, dann schau ich neu.";
    }

    const history = (req.session.sprache ||= []);
    if (a.reply && history[history.length - 1]?.content !== a.reply) {
      history.push({ role: "assistant", content: a.reply }); // Verlauf behaelt das Original
    }
    res.json({ ok: true, fertig: true, reply: a.gesprochen || a.reply || null, hint: a.hint || null, dauerMs: a.dauerMs });
  });

  // Sprachausgabe. Der ElevenLabs-Schluessel bleibt auf dem Server —
  // im Browser waere er fuer jeden auslesbar, der die Seite oeffnet.
  app.post("/api/sprache/stimme", async (req, res) => {
    const key = process.env.ELEVENLABS_API_KEY;
    const voice = process.env.ELEVENLABS_VOICE_ID;
    // Hier und nur hier aufbereiten: So gilt es fuer JEDE gesprochene Antwort —
    // aus dem Zustand, von Hermes oder aus dem Rueckfalltext.
    const text = fuerStimme(String(req.body.text || "")).slice(0, 2500);
    if (!key || !voice) return res.status(503).json({ ok: false, hint: "ElevenLabs ist noch nicht eingerichtet." });
    if (!text) return res.status(400).json({ ok: false, hint: "Kein Text." });
    try {
      const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}/stream?output_format=mp3_44100_128`, {
        method: "POST",
        headers: { "xi-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          model_id: process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2",
          // Optimiert 22.07. fuer natuerlicheres, menschlicheres Sprechen:
          // etwas mehr Konstanz, naeher an der Stimme, mit Ausdruck (style) und
          // Klarheit (speaker_boost), ruhigeres Tempo.
          voice_settings: {
            stability: Number(process.env.EL_STABILITY || 0.5),
            similarity_boost: Number(process.env.EL_SIMILARITY || 0.85),
            style: Number(process.env.EL_STYLE || 0.35),
            use_speaker_boost: true,
            speed: Number(process.env.EL_SPEED || 1.0),
          },
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (!r.ok) {
        const fehler = await r.text().catch(() => "");
        return res.status(502).json({ ok: false, hint: "ElevenLabs: " + fehler.slice(0, 200) });
      }
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Cache-Control", "no-store");
      const { Readable } = require("stream");
      Readable.fromWeb(r.body).pipe(res);
    } catch (e) {
      res.status(502).json({ ok: false, hint: String(e.message).slice(0, 200) });
    }
  });

  // Verrät dem Browser, ob eine echte Stimme bereitsteht.
  app.get("/api/sprache/status", (req, res) => {
    const name = req.session.crm?.name?.split(" ")[0] || "";
    res.json({
      elevenlabs: Boolean(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID),
      hermes: Boolean(process.env.HERMES_CHAT_URL),
      wakeWord: (process.env.WAKE_WORD || "alexandra").toLowerCase(),
      // Wird beim Wecken gesprochen. Einmal erzeugt, dann im Browser
      // wiederverwendet — kostet also nur beim ersten Mal Guthaben.
      begruessung: process.env.BEGRUESSUNG || (name ? `Hallo ${name}.` : "Ja bitte?"),
    });
  });
};

// ---------------------------------------------------------------- Seite

function seite() {
  const BARS = 64;
  const bars = Array.from({ length: BARS }, (_, i) => {
    const a = (i / BARS) * Math.PI * 2 - Math.PI / 2;
    const r1 = 118, r2 = 138;
    const x1 = (200 + Math.cos(a) * r1).toFixed(1), y1 = (200 + Math.sin(a) * r1).toFixed(1);
    const x2 = (200 + Math.cos(a) * r2).toFixed(1), y2 = (200 + Math.sin(a) * r2).toFixed(1);
    return `<line class="pegel" data-i="${i}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  }).join("");

  return `
<div class="voix">
  <div class="voix-atmo"></div>
  <div class="voix-grain"></div>

  <div id="kugel" class="voix-orb" data-zustand="ruhe" role="button" tabindex="0"
       aria-label="Sprechen — klicken oder „Hey Alexandra“ sagen">
    <div class="voix-bloom"></div>
    <div class="voix-halo"></div>
    <svg class="voix-svg" viewBox="0 0 400 400" aria-hidden="true">
      <defs>
        <radialGradient id="vx-kern" cx="50%" cy="45%" r="55%">
          <stop offset="0%"   stop-color="#eafff9" stop-opacity=".98"/>
          <stop offset="34%"  stop-color="var(--vx)" stop-opacity=".85"/>
          <stop offset="72%"  stop-color="var(--vx)" stop-opacity=".22"/>
          <stop offset="100%" stop-color="var(--vx)" stop-opacity="0"/>
        </radialGradient>
        <filter id="vx-glow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="4" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <circle class="vx-ring vx-r3" cx="200" cy="200" r="172"/>
      <circle class="vx-ring vx-r2" cx="200" cy="200" r="150"/>
      <circle class="vx-ring vx-r1" cx="200" cy="200" r="126"/>
      <circle class="vx-kern" cx="200" cy="200" r="92" fill="url(#vx-kern)"/>
      <g class="vx-bars" filter="url(#vx-glow)">${bars}</g>
    </svg>
    <span id="kugel-wort" hidden></span>
    <span id="zustand-text" hidden></span>
    <div id="kugel-hinweis" class="voix-cue">Sag „Hey Alexandra“ oder tippe</div>
  </div>

  <div class="voix-tools">
    <button id="btn-wake" class="vx-tool" type="button" title="Dauerhaft auf „Hey Alexandra“ lauschen">
      <span class="vx-dot" id="wake-punkt"></span> Wake
    </button>
    <button id="btn-stop" class="vx-tool" type="button" title="Sprechen abbrechen">Stopp</button>
    <button id="btn-frisch" class="vx-tool" type="button" title="Kalender & Zahlen neu einlesen">↻</button>
    <span class="vx-voice" id="stimme-info"></span>
  </div>
  <!-- unsichtbare Haken fuer die Bedienlogik -->
  <div id="karten" hidden></div><div id="verlauf" hidden></div>
</div>

<style>
/* ── Alexandra — Voice-Buehne. Eigene, in sich geschlossene dunkle Welt:
      keine Transkripte, kein Text — nur die lebendige Kugel, die zeigt, wie
      Alexandra spricht. Bricht bewusst aus dem hellen Dashboard-Layout aus. ── */
.voix{--vx:#34e3cf;--vx2:#1fa8ff;
  position:relative;isolation:isolate;overflow:hidden;
  min-height:calc(100vh - 132px);margin:-4px -6px;border-radius:26px;
  display:grid;place-items:center;
  background:
    radial-gradient(120% 90% at 50% 8%, rgba(31,168,255,.10), transparent 60%),
    radial-gradient(90% 80% at 50% 118%, rgba(52,227,207,.12), transparent 62%),
    #060a12;
  box-shadow:inset 0 0 200px rgba(0,0,0,.75), 0 30px 90px -40px rgba(0,0,0,.8)}
@media (max-width:900px){.voix{min-height:calc(100vh - 96px)}}

/* driftende Aurora + Vignette */
.voix-atmo{position:absolute;inset:-30%;z-index:-2;
  background:
    radial-gradient(38% 42% at 30% 34%, rgba(31,168,255,.22), transparent 70%),
    radial-gradient(42% 46% at 72% 66%, rgba(52,227,207,.20), transparent 72%);
  filter:blur(30px);animation:vx-drift 26s ease-in-out infinite alternate}
.voix::after{content:"";position:absolute;inset:0;z-index:-1;pointer-events:none;
  background:radial-gradient(closest-side at 50% 50%, transparent 58%, rgba(0,0,0,.55) 100%)}
@keyframes vx-drift{from{transform:translate3d(-3%,-2%,0) scale(1)}to{transform:translate3d(4%,3%,0) scale(1.08)}}

/* feine Koernung fuer Kino-Tiefe */
.voix-grain{position:absolute;inset:0;z-index:1;pointer-events:none;opacity:.05;mix-blend-mode:overlay;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}

/* ── Die Kugel ── */
.voix-orb{position:relative;z-index:2;width:min(66vmin,560px);aspect-ratio:1;
  display:grid;place-items:center;cursor:pointer;user-select:none;
  transition:transform .5s cubic-bezier(.2,.9,.2,1)}
.voix-orb:active{transform:scale(.98)}
.voix-svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}

/* Bloom + Halo hinter dem Kern */
.voix-bloom{position:absolute;width:52%;aspect-ratio:1;border-radius:50%;
  background:radial-gradient(circle,var(--vx) 0%,transparent 68%);
  filter:blur(34px);opacity:.5;transition:opacity .6s,background .6s;animation:vx-atmen 6s ease-in-out infinite}
.voix-halo{position:absolute;width:86%;aspect-ratio:1;border-radius:50%;
  border:1px solid color-mix(in srgb,var(--vx) 35%,transparent);opacity:.3;
  transition:opacity .6s,border-color .6s}

.vx-ring{fill:none;stroke:color-mix(in srgb,var(--vx) 45%,transparent);stroke-width:1;
  transform-origin:200px 200px;transition:stroke .6s,opacity .6s}
.vx-r1{stroke-dasharray:2 12;opacity:.7}
.vx-r2{stroke-dasharray:1 20;opacity:.4}
.vx-r3{stroke-dasharray:34 16;opacity:.22}
.vx-kern{opacity:.62;transform-origin:200px 200px;transition:opacity .6s}
.pegel{stroke:var(--vx);stroke-width:3;stroke-linecap:round;opacity:.28;
  transform-origin:200px 200px;transition:opacity .5s,stroke .6s;will-change:transform}

.voix-cue{position:absolute;bottom:-6%;font-size:12px;letter-spacing:.34em;
  text-transform:uppercase;font-weight:600;color:rgba(220,240,245,.34);
  transition:opacity .5s;pointer-events:none}

/* ── Zustaende: Farbe + Bewegung erzaehlen alles, ohne Worte ── */
.voix-orb[data-zustand="ruhe"] .vx-r1{animation:vx-dreh 60s linear infinite}
.voix-orb[data-zustand="ruhe"] .vx-kern{animation:vx-atmen 6.5s ease-in-out infinite}

.voix-orb[data-zustand="lauschen"]{--vx:#2fa6ff}
.voix-orb[data-zustand="lauschen"] .vx-r1{animation:vx-dreh 11s linear infinite}
.voix-orb[data-zustand="lauschen"] .vx-r2{animation:vx-dreh 20s linear infinite reverse}
.voix-orb[data-zustand="lauschen"] .pegel{opacity:.9}
.voix-orb[data-zustand="lauschen"] .voix-bloom{opacity:.7}
.voix-orb[data-zustand="lauschen"] .voix-cue{opacity:0}

.voix-orb[data-zustand="denken"]{--vx:#ffc24d}
.voix-orb[data-zustand="denken"] .vx-r2{opacity:.95;stroke-dasharray:90 560;animation:vx-dreh 1.2s linear infinite}
.voix-orb[data-zustand="denken"] .vx-r1{animation:vx-dreh 22s linear infinite reverse}
.voix-orb[data-zustand="denken"] .vx-kern{animation:vx-atmen 1.5s ease-in-out infinite}
.voix-orb[data-zustand="denken"] .voix-cue{opacity:0}

.voix-orb[data-zustand="sprechen"]{--vx:#35e3cf}
.voix-orb[data-zustand="sprechen"] .vx-r3{animation:vx-dreh 30s linear infinite}
.voix-orb[data-zustand="sprechen"] .pegel{opacity:1;stroke-width:3.4}
.voix-orb[data-zustand="sprechen"] .voix-bloom{opacity:.9;animation:vx-puls 2.4s ease-in-out infinite}
.voix-orb[data-zustand="sprechen"] .voix-halo{opacity:.6;animation:vx-halo 2.6s ease-out infinite}
.voix-orb[data-zustand="sprechen"] .voix-cue{opacity:0}

@keyframes vx-dreh{to{transform:rotate(360deg)}}
@keyframes vx-atmen{0%,100%{opacity:.5;transform:scale(1)}50%{opacity:.92;transform:scale(1.06)}}
@keyframes vx-puls{0%,100%{opacity:.62;transform:scale(1)}50%{opacity:1;transform:scale(1.12)}}
@keyframes vx-halo{0%{transform:scale(.9);opacity:.6}100%{transform:scale(1.18);opacity:0}}
@media (prefers-reduced-motion:reduce){.vx-ring,.vx-kern,.pegel,.voix-bloom,.voix-halo,.voix-atmo{animation:none!important}}

/* ── Dezente Werkzeuge, unten schwebend ── */
.voix-tools{position:absolute;z-index:3;bottom:22px;left:50%;transform:translateX(-50%);
  display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:999px;
  background:rgba(10,16,24,.55);border:1px solid rgba(255,255,255,.08);
  backdrop-filter:blur(12px);opacity:.35;transition:opacity .35s}
.voix:hover .voix-tools,.voix-tools:focus-within{opacity:1}
.vx-tool{appearance:none;border:0;background:transparent;color:rgba(224,240,245,.82);
  font:inherit;font-size:12px;letter-spacing:.06em;padding:6px 12px;border-radius:999px;
  cursor:pointer;display:inline-flex;align-items:center;gap:7px;transition:background .2s,color .2s}
.vx-tool:hover{background:rgba(255,255,255,.08);color:#fff}
.vx-dot{width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,.3);transition:background .3s,box-shadow .3s}
.vx-dot.an{background:#35e3cf;box-shadow:0 0 10px #35e3cf}
.vx-voice{font-size:11px;letter-spacing:.05em;color:rgba(224,240,245,.4);padding-right:6px}
</style>

<!-- Bedienlogik: /public/sprache.js (dieselbe Datei ueberall via Schale). -->
`;
}
