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
const sprachlog = require("./sprachlog.js");
const suche = require("./suche.js");

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
{"text": "<was du jetzt aus dem STAND sagst — Termine, Zahlen, Reports>",
 "mail": {"an": "<adresse>", "betreff": "<betreff>", "body": "<voller Mailtext>"} oder null,
 "whatsapp": {"an": "<Name, Nummer oder Gruppenname>", "text": "<Nachricht>", "gruppe": true/false} oder null,
 "termin": {"was": "eintragen"|"verschieben"|"absagen", "suche": "<welcher Termin, bei verschieben/absagen>",
            "titel": "", "start": "<JJJJ-MM-TTTHH:MM>", "ende": "", "ganztags": false, "ort": "", "tag": ""} oder null,
 "aufgabe": {"was": "anlegen"|"erledigt", "titel": "<bei anlegen>", "suche": "<bei erledigt: welche>",
             "faellig": "<JJJJ-MM-TT oder leer>", "geplant": "<JJJJ-MM-TT oder leer>"} oder null,
 "crm": {"was": "lead"|"notiz"|"wiedervorlage"|"anruf", "firma": "<Firmenname>", "text": "<bei notiz>",
         "datum": "<JJJJ-MM-TT>", "ausgang": "termin"|"absage"|"nicht-erreicht"|"spaeter"|"erreicht",
         "quelle": "", "ort": "", "telefon": "", "email": "", "notiz": ""} oder null,
 "aktionen": [ {"was": "wetter"|"mail"|"gehirn"|"sonnet"|"hermes", "auftrag": "<fokussierter Arbeitsteil>"} ],
 "zeige": ["kalender"|"zahlen"]}

## Laenge — hart
"text" ist HOECHSTENS DREI SAETZE. Keine Nebenbemerkungen, keine Einordnung.
Schliesse das JSON immer vollstaendig — abgeschnitten geht die ganze Antwort
samt vorbereiteter Nachricht verloren.

## Bei "termin", "aufgabe" oder "crm": Ergebnis NICHT selbst sagen
Der Server fuehrt aus und bestaetigt ("Steht — …", "Abgehakt: …"). Kuendige es
nicht an. "text" bleibt dann leer — oder enthaelt nur, was der Server NICHT
sagt (eine Warnung, eine Kollision).

## Aktionen — parallel, so viele wie noetig
Fragt Lukas nach mehreren Dingen, zerlegst du sie: Was aus dem STAND kommt,
gehoert in "text" (KEINE Aktion) — fuer alles andere je eine Aktion, alle
gleichzeitig. Jede bekommt NUR ihren Arbeitsteil, nie die ganze Aeusserung.
Beispiel "was steht morgen an, neue Mails, wie wird das Wetter" -> text = die
Termine, aktionen = mail + wetter.

wetter   — auftrag MIT Tag ("Wetter uebermorgen in Dorfen").
mail     — Posteingang pruefen, auftrag = Zeitfenster. Nur lesen, nie senden.
wa_lesen — WhatsApp lesen. Bestimmter Chat -> auftrag = NUR der Kontakt- oder
           Gruppenname. Allgemein ("gibt's neue Nachrichten") -> auftrag =
           "neue Nachrichten", dann fasst der Server alle Chats zusammen.
           Nur ab dem Koppeln; erfinde keine "nicht verbunden"-Ausrede.
gehirn   — Wissen, das NICHT unter FIRMA im STAND steht: frueher Entschiedenes,
           Projektnotizen, Wiki. Preise/Leistungen/Team stehen im STAND — die
           sagst du DIREKT. Nicht fuer Server-Status (weiss nur hermes), und nie
           gehirn UND hermes fuers selbe Anliegen.
sonnet   — kurze Recherche: Fakten, Preise, News, Zahlen vergleichen.
hermes   — lange Arbeit UND jedes Kommando ans System: Praesentation, Angebot,
           Website, externe Mails; Einstellungen/Modelle aendern, Cron-Jobs und
           Routinen anlegen, Automatisierungen bauen, Status abfragen.
           auftrag = das Kommando im Klartext, in Lukas' Worten.

Wetter und neue Mails stehen NIE im STAND — dafuer immer eine Aktion, nie raten.
Ist nichts zu tun, bleibt "aktionen" leer.

## Haltung
Du bist handlungsfaehig, kein Frage-Antwort-Modell: Du kannst Mails und WhatsApp
SENDEN, Chats lesen, Termine und Aufgaben verwalten, recherchieren und ueber
hermes alles am OS aendern. Kontakte loest der SERVER auf — du brauchst nie eine
Nummer. Sag nie "ich kenne X nicht" oder "dafuer bin ich nicht zustaendig", und
erfinde nie fehlende "API-Verbindungen". Im Zweifel geht es an hermes und
niemals ablehnen, was du kannst. Bei klarem Auftrag legst du sofort los.

EHRLICH SCHEITERN IST ERLAUBT: Geht etwas wirklich nicht, sag es in EINEM Satz
und mach weiter — keine Entschuldigung, keine Ausrede. Behaupte NIE, etwas sei
erledigt, um eine Absage zu vermeiden.

NUR EINE RUECKFRAGE, und die stellt der SERVER: die Freigabe vor dem Senden.
Frag NIE "soll ich es dir vorlesen?", "soll ich loslegen?", "passt das so?".
Vorbereitetes liest du immer von selbst vor. Nur wenn ohne eine fehlende Angabe
gar nicht startbar ist, fragst du kurz und konkret.

NIE FALSCH DEMENTIEREN: Behaupte nie, du haettest etwas NICHT getan, nur weil es
nicht im Verlauf steht. Sag: "Hab ich gerade nicht mehr im Gespraech — worum
ging's?"

## Wahrheit — was du behaupten darfst
Wahr ist NUR, was im STAND oder in einem [FAKT]-Marker steht. Dein eigener Satz
von vorhin zaehlt NICHT als Bestaetigung.
- Was du gerade anstoesst, ist noch NICHT erledigt. Sprich in der Absicht:
  RICHTIG "Trag ich dir gleich ein." · "Schick ich gleich raus." · "Bin dran."
  FALSCH  "Steht." · "Ist eingetragen." · "Ist unterwegs." · "Ist raus."
- Erfinde NIE Termine, die nur aus deiner eigenen Ankuendigung stammen.
- Steht "[LAEUFT NOCH ...]" im Verlauf, ist genau das offen: "ist noch in Arbeit".
- Zwischenfrage ("wie schaut's aus?"): antworte aus "DEINE LAUFENDE ARBEIT" im
  STAND (was laeuft, seit wie vielen Sekunden). Stosse dieselbe Arbeit NICHT
  nochmal an. Steht dort nichts, laeuft auch nichts — sag das ehrlich.

## Sprechen
- SAG ES EINMAL. Kuendige nicht an, was du gleich sagst, und wiederhole dich
  nicht. Kein "Mach ich", kein "Schau ich nach", kein "Einen Moment" — sag
  direkt die Sache. Stoesst du im Hintergrund etwas an, gehoert das in EINEN
  Nebensatz derselben Antwort, nicht in einen eigenen Satz davor.
- NIE interne Begriffe: "Spur", "Hermes", "Sonnet", "Haiku", "Zustand",
  "Modell", "Auftrag-ID". Lukas hoert nur natuerliche Sprache.
- NICHT WIEDERHOLEN: BISHER zeigt, was du schon gesagt hast. Antworte nur auf
  die letzte Aeusserung; schon Vorgelesenes nennst du nicht erneut. Geht es nur
  um die Mail, redest du nur ueber die Mail.
- "text" nur leer lassen, wenn wirklich nichts aus dem STAND zu sagen ist.

## Kalender aendern — immer ueber "termin", NIE ueber hermes
Der Server macht es in etwa einer Sekunde und bestaetigt; erst dann sagst du,
dass es steht. Zeiten als JJJJ-MM-TTTHH:MM in Ortszeit, relative Angaben
("morgen", "Freitag") rechnest du aus HEUTE im STAND aus.

EINTRAGEN ("trag mir morgen 10 Uhr Sport ein"): was="eintragen" + titel + start.
  "ende" nur bei genannter Dauer (sonst eine Stunde). Ganztaegig: ganztags=true
  und start nur als JJJJ-MM-TT. Fehlt die Uhrzeit ganz, frag EINMAL kurz nach.
VERSCHIEBEN ("schieb Physio auf Donnerstag 15 Uhr"): was="verschieben",
  suche="Physio" (wie Lukas ihn nennt), start=NEUE Zeit.
ABSAGEN ("sag den Kalhofer-Anruf ab"): was="absagen", suche=Bezeichnung,
  optional tag=JJJJ-MM-TT.
Die Termin-ID brauchst du nie — der Server findet ihn; passen mehrere, fragt er.

WANN HAB ICH ZEIT ("wann hab ich Freitag Zeit?"): KEIN "termin", KEINE Aktion —
im STAND stehen alle Termine. Lies die Luecken selbst ab ("Freitag bis elf frei,
dann wieder ab vier"), im Rahmen ueblicher Arbeitszeiten.

## Aufgaben (die Liste im CRM)
Unter AUFGABEN im STAND stehen die offenen. Auf "was steht heute an?" nennst du
Termine UND die heute geplanten oder ueberfaelligen Aufgaben.
ANLEGEN ("setz X auf die Liste", "erinner mich an Y"): was="anlegen", titel kurz.
  "faellig"/"geplant" nur bei genannter Frist ("bis Freitag" -> faellig).
ERLEDIGT ("hab ich erledigt"): was="erledigt", suche = wie Lukas sie nennt.
Eine Aufgabe ist etwas ZU TUN, ein Termin hat eine Uhrzeit.

## CRM (Vertriebsarbeit)
lead         — "leg einen Lead an: Physio Schwabing, kam ueber Empfehlung".
               "firma" = der Name, "quelle"/"ort"/"telefon"/"email" wenn genannt.
notiz        — "notier bei Krotzer, dass sie erst im September Budget haben".
               "firma" + "text" (der Inhalt, in Lukas' Worten).
wiedervorlage— "erinner mich in einer Woche an Mueller": "firma" + "datum".
anruf        — Ergebnis eines Telefonats: "firma" + "ausgang".
               termin = Erstgespraech gebucht · absage = verloren (dann "grund")
               nicht-erreicht = niemand da · spaeter = spaeter nochmal, BRAUCHT
               "datum" · erreicht = gesprochen, sonst nichts davon.
Datumsangaben rechnest DU aus HEUTE aus und lieferst JJJJ-MM-TT — der Server
rechnet nicht. Den Firmennamen sagst du so, wie Lukas ihn nennt; der Server
findet die Firma und fragt bei mehreren Treffern zurueck.

## Mail
"mail" nur, wenn sie (a) ganz aus dem STAND formulierbar ist UND (b) an Lukas
selbst oder intern geht ("an mich" = lukas.sehorz@hotmail.com).
Extern, Antwort auf einen Verlauf oder Recherche noetig -> "mail" bleibt null,
stattdessen Aktion hermes: in Lukas' Ton als ENTWURF vorbereiten, NICHT senden.

## WhatsApp
"whatsapp" fuellst du mit dem Empfaenger und in "text" der ABSICHT — nicht dem
fertigen Wortlaut: "schreib Jannik, wann er wieder da ist" -> text = "frag
Jannik, wann er wieder im Buero ist". Der Server formuliert aus, liest vor und
holt die Freigabe. Nie Serienversand an viele.
Gruppen: "gruppe": true und in "an" den Gruppennamen. Nur wenige Arbeitsgruppen
sind freigegeben; kennt der Server eine nicht, sagt er es. Erfinde keine
Gruppennamen und behaupte nie, du koenntest nicht in Gruppen schreiben.`;

// Verstehen laeuft auf Sonnet (Entscheidung Lukas 24.07.): Das Interpretieren
// der Aeusserung — Absicht erkennen, STAND lesen, in Aktionen zerlegen — ist
// der schwerste Schritt im ganzen Gespraech, und auf Haiku war er der
// Haupttreiber fuer "versteht falsch / antwortet daneben". Die Blitz-Zusage
// (unten) bleibt bewusst auf Haiku und ueberbrueckt die 2-3 s, die Sonnet
// laenger denkt. Faellt Sonnet aus (Timeout, 529), faengt Haiku auf — lieber
// eine schlichte Antwort als gar keine. Das Weiterreichen langer Arbeit an
// Hermes bleibt davon unberuehrt: hier aendert sich nur, WER versteht.
const VERSTEHEN_MODELL = process.env.SPRACHE_VERSTEHEN_MODEL || "claude-sonnet-5";
const VERSTEHEN_RESERVE = process.env.SCHNELL_MODEL || "claude-haiku-4-5";

async function ausZustand(frage, zustandText, history = []) {
  const verlauf = history.map((h) => `${h.role === "user" ? "Lukas" : "Du"}: ${h.content}`).join("\n");
  // _diag wandert ins Sprachprotokoll: Modell, Dauer, ob die Reserve einsprang,
  // ob die Antwort sauberes JSON war. Der Browser bekommt es nie zu sehen.
  const diag = { modell: VERSTEHEN_MODELL, dauerMs: 0, reserve: false, parse: "ok", fehler: null };
  const start = Date.now();
  try {
    // Lukas' Stilproben sind ~1.300 Token und wurden bisher bei JEDER
    // Aeusserung mitgeschickt — gebraucht werden sie aber nur, wenn in seinem
    // Namen ein Text entsteht (mail.body). Bei "was steht morgen an" waren sie
    // reiner Ballast, der Antwort und Regeltreue verschlechtert hat. Fuer
    // WhatsApp laedt komponiere() sie ohnehin selbst.
    const brauchtTon = /\b(mail|e-?mail|schreib|schreibe|verfass|formulier|antwort|entwurf|text)\w*\b/i.test(frage);
    const ton = brauchtTon ? tonLaden() : "";
    const system = stimmeLaden() + FORMAT_ANHANG +
      (ton ? "\n\n## STILPROBEN (nur fuer Texte in Lukas' Namen, z. B. mail.body)\n" + ton : "");
    const nutzer = `STAND:\n${zustandText}\n\n${verlauf ? "BISHER:\n" + verlauf + "\n\n" : ""}FRAGE: ${frage}`;
    let roh;
    try {
      roh = await schnell.frage(system, nutzer, { maxTokens: 1400, temp: 0.4, model: VERSTEHEN_MODELL, timeoutMs: 30000 });
    } catch (e) {
      diag.reserve = true;
      diag.fehler = String(e.message).slice(0, 200);
      diag.modell = VERSTEHEN_RESERVE;
      roh = await schnell.frage(system, nutzer, { maxTokens: 1400, temp: 0.4, model: VERSTEHEN_RESERVE });
    }
    diag.dauerMs = Date.now() - start;
    const m = roh.match(/\{[\s\S]*\}/);
    if (!m) {
      diag.parse = "kein-json";
      // ROHES JSON DARF NIE VORGELESEN WERDEN (Vorfall 26.07., 16:01 Uhr).
      // Lukas bekam woertlich zu hoeren:
      //   {"text": "Kleiner Fakt-Check nebenbei: Jannik steht mit vier…
      // Ursache: die Antwort wurde an der Token-Grenze abgeschnitten, das
      // schliessende } fehlte, und der frueher hier stehende roh.slice(0,500)
      // ging direkt in die Sprachausgabe.
      //
      // Schlimmer als das Vorlesen war die Folge: Mit dem JSON gingen auch die
      // strukturierten Felder verloren. Die vorbereitete WhatsApp an Jannik
      // existierte nie — Alexandra sagte trotzdem "geht jetzt raus an Jannik".
      //
      // Deshalb hier bewusst KEIN Bergungsversuch am Text: Ein abgeschnittener
      // Satz kann eine Handlung behaupten, die mangels Feldern nicht passiert
      // ist. Lieber einmal ehrlich nachfragen als einmal falsch melden.
      return {
        text: "Da ist bei mir gerade was schiefgelaufen — sag's nochmal, dann mach ich's.",
        mail: null, whatsapp: null, termin: null, aufgabe: null, crm: null,
        aktionen: [], zeige: [], _diag: diag,
      };
    }
    const p = JSON.parse(m[0]);
    const mail = p.mail && p.mail.an && p.mail.betreff
      ? { an: String(p.mail.an).trim(), betreff: String(p.mail.betreff).slice(0, 200), body: String(p.mail.body || "") }
      : null;
    const wa = p.whatsapp && p.whatsapp.an && p.whatsapp.text
      ? { an: String(p.whatsapp.an).trim().slice(0, 80), text: String(p.whatsapp.text).slice(0, 1500),
          gruppe: Boolean(p.whatsapp.gruppe) }
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
    // "termin" deckt drei Faelle ab: eintragen, verschieben, absagen.
    // Eintragen braucht Titel + Start, die anderen beiden eine Beschreibung.
    let termin = null;
    if (p.termin && typeof p.termin === "object") {
      const was = ["eintragen", "verschieben", "absagen"].includes(p.termin.was)
        ? p.termin.was
        : (p.termin.titel && p.termin.start ? "eintragen" : null);   // Altform
      const gemeinsam = {
        was,
        suche: String(p.termin.suche || "").slice(0, 120),
        titel: String(p.termin.titel || "").slice(0, 200),
        start: String(p.termin.start || "").slice(0, 40),
        ende: p.termin.ende ? String(p.termin.ende).slice(0, 40) : "",
        ganztags: Boolean(p.termin.ganztags),
        ort: String(p.termin.ort || "").slice(0, 200),
        tag: String(p.termin.tag || "").slice(0, 10),
      };
      const brauchbar = was === "eintragen"
        ? Boolean(gemeinsam.titel && gemeinsam.start)
        : Boolean(was && (gemeinsam.suche || gemeinsam.tag));
      if (brauchbar) termin = gemeinsam;
    }

    // Aufgaben: anlegen oder abhaken.
    let aufgabe = null;
    if (p.aufgabe && typeof p.aufgabe === "object") {
      const was = ["anlegen", "erledigt"].includes(p.aufgabe.was) ? p.aufgabe.was : null;
      const a = {
        was,
        titel: String(p.aufgabe.titel || "").slice(0, 200),
        suche: String(p.aufgabe.suche || "").slice(0, 120),
        faellig: /^\d{4}-\d{2}-\d{2}$/.test(String(p.aufgabe.faellig || "")) ? p.aufgabe.faellig : null,
        geplant: /^\d{4}-\d{2}-\d{2}$/.test(String(p.aufgabe.geplant || "")) ? p.aufgabe.geplant : null,
      };
      if (was === "anlegen" ? a.titel : (was === "erledigt" && a.suche)) aufgabe = a;
    }

    // CRM-Arbeit: Lead, Notiz, Wiedervorlage, Anrufergebnis.
    let crmAuftrag = null;
    if (p.crm && typeof p.crm === "object") {
      const was = ["lead", "notiz", "wiedervorlage", "anruf"].includes(p.crm.was) ? p.crm.was : null;
      const c = {
        was,
        firma: String(p.crm.firma || p.crm.name || "").slice(0, 160),
        text: String(p.crm.text || "").slice(0, 1000),
        datum: /^\d{4}-\d{2}-\d{2}$/.test(String(p.crm.datum || "")) ? p.crm.datum : "",
        ausgang: String(p.crm.ausgang || "").slice(0, 30),
        quelle: String(p.crm.quelle || "").slice(0, 80),
        ort: String(p.crm.ort || "").slice(0, 120),
        telefon: String(p.crm.telefon || "").slice(0, 40),
        email: String(p.crm.email || "").slice(0, 160),
        notiz: String(p.crm.notiz || "").slice(0, 500),
        grund: String(p.crm.grund || "").slice(0, 200),
      };
      if (was && c.firma) crmAuftrag = c;
    }

    return {
      text: String(p.text || "").slice(0, 900),
      mail,
      whatsapp: wa,
      termin,
      aufgabe,
      crm: crmAuftrag,
      aktionen,
      zeige: Array.isArray(p.zeige) ? p.zeige : [],
      _diag: diag,
    };
  } catch (e) {
    // Im Zweifel lieber langsam und richtig als schnell und daneben -> Hermes.
    diag.dauerMs = diag.dauerMs || Date.now() - start;
    diag.parse = "fehler";
    diag.fehler = diag.fehler || String(e.message).slice(0, 200);
    return { text: "", mail: null, whatsapp: null, termin: null, aufgabe: null, crm: null,
      aktionen: [{ was: "hermes", auftrag: "" }], zeige: [], _diag: diag };
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

// Einen bestehenden Termin anhand einer BESCHREIBUNG finden (Phase 4, 25.07.).
//
// Lukas sagt "verschieb den Physio-Termin", nicht eine Termin-ID — die kennt er
// nicht und soll er nie nennen muessen. Also sucht der Server: Wortueberschnei-
// dung im Titel, optional eingegrenzt auf einen Tag.
//
// Passen mehrere gleich gut, wird NICHT geraten, sondern zurueckgefragt. Ein
// abgesagter Termin ist nicht wiederherstellbar, und beim Verschieben faellt
// der Fehler erst auf, wenn jemand zur falschen Zeit dasteht.
function terminFinden(beschreibung, kalender = [], tag = "") {
  const q = String(beschreibung || "").toLowerCase().trim();
  if (!q || !Array.isArray(kalender) || !kalender.length) return null;

  const worte = q.split(/\s+/).filter((w) => w.length > 2 &&
    !/^(der|die|das|den|dem|ein|eine|mein|meine|termin|termine|uhr|am|um|mit|von|zum|zur)$/.test(w));

  const bewertet = kalender
    .filter((t) => t.id && (!tag || String(t.start).startsWith(tag)))
    .map((t) => {
      const titel = String(t.titel || "").toLowerCase();
      let punkte = 0;
      if (titel === q) punkte = 100;
      else if (titel.includes(q)) punkte = 90;
      else punkte = worte.reduce((n, w) => n + (titel.includes(w) ? 30 : 0), 0);
      // Ein genannter Tag allein reicht, wenn es dort nur einen Termin gibt.
      if (!punkte && tag && !worte.length) punkte = 20;
      return { t, punkte };
    })
    .filter((x) => x.punkte >= 20)
    .sort((a, b) => b.punkte - a.punkte);

  if (!bewertet.length) return null;
  const gleichauf = bewertet.filter((x) => x.punkte === bewertet[0].punkte);
  if (gleichauf.length > 1) {
    return { mehrdeutig: gleichauf.slice(0, 4).map((x) => ({ titel: x.t.titel, start: x.t.start })) };
  }
  return bewertet[0].t;
}

// Empfaenger aufloesen: Person ODER freigegebene Arbeitsgruppe (Lukas 24.07.).
// "die Gruppe Team Flowstate" wird auch ohne gesetztes Flag als Gruppe erkannt.
// Ohne Hinweis zuerst als Person suchen — Gruppen sind der Sonderfall, und in
// eine Gruppe zu schreiben erreicht viele auf einmal.
function empfaengerFinden(an, alsGruppe) {
  const roh = String(an || "").trim();
  const m = roh.match(/^(?:in\s+)?(?:die\s+)?gruppe\s+(.+)$/i);
  const name = (m ? m[1] : roh).replace(/[-\s]?gruppe$/i, "").trim() || roh;
  if (alsGruppe || m) return kontakte.findeGruppe(name);
  return kontakte.finde(name) || kontakte.findeGruppe(name);
}

// ---------------------------------------------------------------- Hermes

// Hermes im STREAMING-Modus fragen (Stufe 2, 24.07.). Zweck: Waehrend er
// arbeitet, sollen echte Zwischenstaende ankommen — nur so kann Alexandra
// unterwegs sagen, WORAN sie gerade ist, ohne Fortschritt zu erfinden.
// melde(teilText) bekommt fortlaufend den bisherigen Text.
//
// Kann der Endpunkt kein Streaming (oder liefert er nichts Brauchbares), wirft
// diese Funktion — der Aufrufer nimmt dann den bisherigen Einmal-Weg. Damit
// aendert sich fuer ein nicht-streamendes Hermes GAR NICHTS.
// Wie lange wir auf das ERSTE brauchbare Datenstueck warten. Kommt in dieser
// Zeit nichts, kann der Endpunkt offenbar nicht streamen — dann abbrechen und
// den normalen Weg gehen. Ohne diese Schranke liefe der Versuch bis ins volle
// Timeout (170 s) und der normale Weg DANACH nochmal so lange: die Wartezeit
// haette sich verdoppelt, statt sich zu verkuerzen.
const ERSTE_DATEN_MS = Number(process.env.HERMES_STREAM_PROBE_MS || 25000);

// null = noch nicht ausprobiert, true/false = Ergebnis des ersten Versuchs.
let streamGeht = null;

async function hermesStream(url, headers, koerper, melde) {
  const abbruch = new AbortController();
  let ersteDaten = false;
  const probe = setTimeout(() => { if (!ersteDaten) abbruch.abort(); }, ERSTE_DATEN_MS);
  const gesamt = setTimeout(() => abbruch.abort(), 170000);
  const aufraeumen = () => { clearTimeout(probe); clearTimeout(gesamt); };

  let r;
  try {
    r = await fetch(url, {
      method: "POST", headers,
      body: JSON.stringify({ ...koerper, stream: true }),
      signal: abbruch.signal,
    });
  } catch (e) {
    aufraeumen();
    throw new Error(ersteDaten ? String(e.message) : "keine Stream-Daten in " + Math.round(ERSTE_DATEN_MS / 1000) + " s");
  }
  if (!r.ok || !r.body) { aufraeumen(); throw new Error("Streaming nicht moeglich (" + r.status + ")"); }

  const leser = r.body.getReader();
  const dekoder = new TextDecoder();
  const start = Date.now();
  let puffer = "";
  let text = "";
  try {
  while (true) {
    const { done, value } = await leser.read();
    if (done) break;
    puffer += dekoder.decode(value, { stream: true });
    // Server-Sent-Events: Zeilen mit "data: {...}", Ende mit "data: [DONE]".
    const zeilen = puffer.split("\n");
    puffer = zeilen.pop() || "";
    for (const z of zeilen) {
      const nutz = z.trim();
      if (!nutz.startsWith("data:")) continue;
      const roh = nutz.slice(5).trim();
      if (roh === "[DONE]") continue;
      let d;
      try { d = JSON.parse(roh); } catch { continue; }
      const stueck = d?.choices?.[0]?.delta?.content || d?.choices?.[0]?.message?.content || "";
      if (!stueck) continue;
      if (!ersteDaten) {
        ersteDaten = true;
        clearTimeout(probe);
        sprachlog.schreiben({ art: "hermes-stream", moeglich: true, ersteDatenMs: Date.now() - start });
      }
      text += stueck;
      try { melde(text); } catch {}
    }
  }
  } finally { aufraeumen(); }
  if (!text.trim()) throw new Error("Streaming lieferte keinen Text");
  return text;
}

async function hermesAnfrage(text, history = [], melde = null) {
  const url = process.env.HERMES_CHAT_URL;
  if (!url) return { ok: false, hint: "HERMES_CHAT_URL fehlt." };
  const headers = { "Content-Type": "application/json" };
  if (process.env.HERMES_API_KEY) headers["Authorization"] = "Bearer " + process.env.HERMES_API_KEY;
  const koerper = {
    model: process.env.HERMES_MODEL || "hermes-agent",
    messages: [...history, { role: "user", content: text }],
  };

  // Streamen ist STANDARDMAESSIG AUS (Messung 24.07., 23:53 Uhr).
  //
  // Der Gedanke war: Hermes' Zwischenstaende hoerbar machen, damit Alexandra
  // unterwegs sagen kann, woran sie ist. Das Protokoll zeigt, dass Hermes so
  // NICHT arbeitet: Er denkt 11 s lang stumm und schiebt die fertige Antwort
  // dann in gut einer Sekunde raus ("erste Daten nach 11.3 s", "fertig nach
  // 12.4 s"). Es gibt also keinen Fortschritt zu erzaehlen — nur ein Ergebnis,
  // das eine Sekunde frueher kommt.
  //
  // Schlimmer: Aufgaben, die laenger als die Probezeit nachdenken, wurden von
  // ihr ABGEBROCHEN ("This operation was aborted") und danach komplett neu
  // gestartet — dieselbe Arbeit zweimal, und Lukas wartete doppelt so lang.
  //
  // Der Code bleibt (getestet, ueber HERMES_STREAM=an einschaltbar), falls
  // Hermes spaeter echten Fortschritt liefert. Bis dahin: aus.
  if (melde && process.env.HERMES_STREAM === "an" && streamGeht !== false) {
    try {
      const reply = await hermesStream(url, headers, koerper, melde);
      streamGeht = true;
      return { ok: true, reply };
    } catch (e) {
      // Kein Streaming moeglich -> ganz normal weiter. Vermerken, damit im
      // Protokoll steht, warum keine Zwischenstaende kamen.
      streamGeht = false;
      sprachlog.schreiben({ art: "hermes-stream", moeglich: false, grund: String(e.message).slice(0, 150) });
    }
  }

  return fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...koerper, stream: false }),
    // 15 Minuten statt der frueheren 170 Sekunden (A2, 26.07.).
    //
    // Die 170 s stammten aus der Zeit, als Lukas im Gespraech darauf wartete.
    // Jetzt wartet niemand mehr synchron — das Ergebnis kommt ueber Telegram.
    //
    // ABER ACHTUNG, HARTE OBERGRENZE BEI 300 SEKUNDEN (Messung 26.07., 19:00):
    // Dieses Signal greift in der Praxis nie. Nodes eingebauter HTTP-Client
    // (undici) bricht vorher von sich aus ab — headersTimeout und bodyTimeout
    // stehen standardmaessig auf 300 s. Der Fehler kommt dann als nichtssagendes
    // "fetch failed" nach exakt 301 Sekunden.
    //
    // Wer hier laenger warten will, muss NICHT diesen Wert erhoehen, sondern
    // einen eigenen Dispatcher setzen (undici-Agent mit headersTimeout/
    // bodyTimeout) oder auf http.request umsteigen. Beides bedeutet eine neue
    // Abhaengigkeit bzw. mehr Code — fuer Hermes bewusst nicht gemacht, weil er
    // ohnehin durch Claude Code ersetzt wird (Stufe E).
    signal: AbortSignal.timeout(15 * 60 * 1000),
  })
    .then((r) => r.json())
    .then((d) => {
      const reply = d?.choices?.[0]?.message?.content;
      return reply ? { ok: true, reply } : { ok: false, hint: d?.error?.message || "Unerwartete Antwort." };
    })
    // Ursache mitschreiben (26.07.): "fetch failed" allein sagt nichts. Der
    // eigentliche Grund steckt in e.cause — bei der abgebrochenen PowerPoint
    // war es ein Headers-Timeout nach 300 s, und genau das war aus dem
    // Protokoll nicht ablesbar. Eine Zeile, die die naechste Analyse spart.
    .catch((e) => {
      const ursache = e?.cause?.code || e?.cause?.message || "";
      return { ok: false, hint: (String(e.message) + (ursache ? ` (${ursache})` : "")).slice(0, 200) };
    });
}

// Modell-Kommandos robust machen (Fix 22.07.): Die Sprache-zu-Text-Erkennung
// verstuemmelt technische Modellnamen — aus "gpt-5.6-sol" wurde "GPT-4.6 Solana",
// Hermes schrieb den ungueltigen Namen in die Config und der Codex-Server lehnte
// jeden Aufruf ab ("das kann ich nicht"). Erwaehnt ein Hermes-Auftrag ein Modell,
// mappen wir bekannte (auch verhoerte) Varianten auf die EINZIG gueltigen Namen
// und geben Hermes die Liste ausdruecklich mit. So kann nie wieder ein kaputter
// Modellname committet werden — Modellwechsel laufen ab jetzt reibungslos.
const GUELTIGE_MODELLE = ["gpt-5.6-sol", "gpt-5.6-luna", "gpt-5.6-terra"];
function modellHinweis(auftrag) {
  if (!/\bmodell?\b|denkst[aä]rke|reasoning|gpt[-\s]?\d/i.test(auftrag)) return auftrag;
  // EINE Regex pro Modell, die das optionale (verhoerte) "gpt-4.6-"-Praefix
  // gleich mitfaengt — so wird jede Stelle genau einmal ersetzt (kein Doppel-
  // Mapping wie "gpt-5.6-gpt-5.6-sol").
  const a = auftrag
    .replace(/\b(?:gpt[-\s]?\d[.,]?\d?[-\s]?)?sol(?:ana|ar|a)?\b/gi, "gpt-5.6-sol")
    .replace(/\b(?:gpt[-\s]?\d[.,]?\d?[-\s]?)?luna\b/gi, "gpt-5.6-luna")
    .replace(/\b(?:gpt[-\s]?\d[.,]?\d?[-\s]?)?terra\b/gi, "gpt-5.6-terra")
    .replace(/\bmond\b/gi, "gpt-5.6-luna")
    .replace(/\berde\b/gi, "gpt-5.6-terra");
  return a +
    `\n\n[WICHTIG — gueltige Modelle: Die EINZIG erlaubten Modellnamen sind ` +
    `${GUELTIGE_MODELLE.join(", ")} (sol = hoechste Qualitaet, langsamer; luna = ` +
    `schnell/ausgewogen; terra = weitere Option). Schreibe AUSSCHLIESSLICH exakt ` +
    `einen dieser Namen in die Config — niemals einen anderen oder erfundenen String. ` +
    `Passt die Anfrage zu keinem, frag kurz nach, statt einen ungueltigen Namen zu setzen.]`;
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

async function denkAnfrage(text) {
  // Wetter kann auch hier landen (Alt-Pfad) -> gleicher Handgriff.
  if (/\bwetter\b|regn|schnei|sonnig|temperatur|wie warm|wie kalt|grad\b/i.test(text)) {
    return wetterAktion(text);
  }

  // Schnellspur (Phase 4, 25.07.): Erst direkt nachschlagen — ein Abruf, unter
  // einer Sekunde, kein Modell dazwischen. Dann macht Haiku daraus einen Satz.
  // Zusammen ~2 s statt bis zu 40 s ueber die Modell-Websuche (die am 25.07.
  // bei "wer wurde Bundesliga-Meister" im Timeout endete, ganz ohne Antwort).
  //
  // Entscheidend ist die Sicherung: Steht die Antwort NICHT im gefundenen Text,
  // wird nicht geraten. Haiku muss dann "NICHT GEFUNDEN" melden, und wir gehen
  // den gruendlichen Weg. Schnell und falsch waere schlimmer als langsam.
  try {
    const fund = await suche.schnellNachschlagen(text);
    if (fund.ok) {
      const satz = await schnell.frage(
        "Beantworte Lukas' Frage in 1-2 kurzen Saetzen — AUSSCHLIESSLICH aus dem gefundenen " +
        "Text unten. Erfinde nichts und ergaenze nichts aus eigenem Wissen. Steht die Antwort " +
        "dort NICHT eindeutig, antworte exakt mit: NICHT GEFUNDEN. Keine Quellenangabe, keine " +
        "Einleitung, keine Aufzaehlung — nur die Antwort, gesprochen und natuerlich.",
        `FRAGE: ${text}\n\nGEFUNDEN (${fund.quelle}, Artikel "${fund.titel}"):\n${fund.text}`,
        { maxTokens: 160, temp: 0.3, timeoutMs: 8000, model: process.env.SCHNELL_ACK_MODEL || "claude-haiku-4-5" }
      );
      const sauber = String(satz).trim();
      const brauchbar = sauber && !/NICHT GEFUNDEN/i.test(sauber);
      sprachlog.schreiben({
        art: "schnellsuche", frage: text.slice(0, 120), titel: fund.titel,
        dauerMs: fund.dauerMs, genutzt: Boolean(brauchbar),
      });
      if (brauchbar) return { ok: true, reply: sauber };
    } else {
      sprachlog.schreiben({ art: "schnellsuche", frage: text.slice(0, 120), genutzt: false, grund: fund.grund });
    }
  } catch (e) {
    sprachlog.schreiben({ art: "schnellsuche", frage: text.slice(0, 120), genutzt: false, grund: String(e.message).slice(0, 120) });
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

// Aendert dieser Auftrag etwas in der Welt (statt nur nachzuschauen)?
// Nur bei solchen darf spaeter "erledigt" gesagt werden — und nur dann kommt
// der [LAEUFT NOCH]-Marker in den Verlauf (Fix 24.07.).
const AENDERND = new Set(["hermes"]);

// Greift der Auftrag in den Kalender ein? Dann ist der STAND danach veraltet
// und muss neu gelesen werden — sonst antwortet Alexandra auf die naechste
// Frage aus dem alten Kalender (oder, schlimmer, aus ihrer eigenen Ankuendigung).
function betrifftKalender(text) {
  return /\bkalender\b|\btermin\w*\b|\beintrag\w*\b|\beintragen\b|\bverschieb\w*\b|\babsag\w*\b/i.test(text);
}

// Was gerade fuer Lukas im Hintergrund laeuft, als Text fuer den STAND.
// Damit bekommt "wie schaut's aus?" mittendrin eine ECHTE Antwort (was laeuft,
// seit wann, was schon fertig ist) — statt dass Alexandra raet oder die Arbeit
// ein zweites Mal anstoesst. Entscheidung Lukas 24.07.
function laufendText(ids = []) {
  const zeilen = [];
  for (const id of ids) {
    const a = AUFTRAEGE.get(id);
    if (!a) continue;
    const sek = Math.round((Date.now() - a.gestartet) / 1000);
    zeilen.push(a.fertig
      ? `- FERTIG (${sek} s gebraucht): ${a.auftragText}`
      : `- LAEUFT SEIT ${sek} s: ${a.auftragText}`);
  }
  return zeilen.length ? "\n\nDEINE LAUFENDE ARBEIT:\n" + zeilen.join("\n") : "";
}

// Loest den [LAEUFT NOCH #id]-Marker im Verlauf auf, sobald das Ergebnis da
// ist: aus "laeuft noch" wird ein bestaetigter [FAKT] — oder ein ehrliches
// "fehlgeschlagen". Ohne diese Aufloesung wuerde Alexandra ewig "ist noch in
// Arbeit" sagen, auch wenn es laengst steht.
function markerAufloesen(history, id, gelungen, auftragText = "") {
  const marker = `[LAEUFT NOCH #${id}:`;
  for (const h of history) {
    const i = typeof h.content === "string" ? h.content.indexOf(marker) : -1;
    if (i < 0) continue;
    const ende = h.content.indexOf("]", i);
    if (ende < 0) continue;
    const was = auftragText || h.content.slice(i + marker.length, ende).split("—")[0].trim();
    h.content = h.content.slice(0, i) +
      (gelungen ? `[FAKT: erledigt und bestaetigt — ${was}]` : `[FAKT: FEHLGESCHLAGEN, nicht erledigt — ${was}]`) +
      h.content.slice(ende + 1);
  }
  return history;
}

// Lange Arbeit meldet sich SELBST (A2, 26.07.).
//
// Vorher haing das Ergebnis am offenen Browser: Der pollte bis zu zehn Minuten.
// Schloss Lukas die Seite, war es weg; blieb er, wartete er im Gespraech auf
// ein Timeout. Am 26.07. um 16:00 startete eine PowerPoint, lief 170 Sekunden
// in den Abbruch und kam nie zurueck — Lukas wusste bis zur Protokollanalyse
// nicht, dass sie gescheitert war.
//
// Jetzt stellt der Server das Ergebnis ueber Telegram zu, mit Stimme. Das
// funktioniert auch, wenn kein Browser offen ist, und ueberlebt einen
// Seitenwechsel. Fehlschlaege werden genauso zugestellt wie Erfolge — lieber
// eine ehrliche Absage als Stille.
function zustellenPerTelegram(id, auftragText, r) {
  const kurz = String(auftragText).replace(/\s+/g, " ").slice(0, 70);
  const gelungen = r?.ok !== false && typeof r?.reply === "string" && r.reply.trim();
  const text = gelungen
    ? String(r.reply).trim()
    : `Das mit „${kurz}“ hat nicht geklappt${r?.hint ? " — " + String(r.hint).slice(0, 120) : ""}. ` +
      `Sag Bescheid, wenn ich es nochmal versuchen soll.`;
  try {
    require("./telegram.js").push(text, { stimme: true })
      .then((z) => sprachlog.schreiben({
        art: "zustellung", id, kanal: "telegram",
        ok: Boolean(z?.ok), gelungen: Boolean(gelungen), grund: z?.grund || null,
      }))
      .catch((e) => sprachlog.schreiben({
        art: "zustellung", id, kanal: "telegram", ok: false, grund: String(e.message).slice(0, 150),
      }));
  } catch (e) {
    sprachlog.schreiben({ art: "zustellung", id, kanal: "telegram", ok: false, grund: String(e.message).slice(0, 150) });
  }
}

// was: "wetter"/"mail" -> fester Handgriff (Sekunden), "sonnet" -> Recherche,
// "hermes" -> lange Arbeit. art "kurz"/"lang" steuert vorn im Frontend, ob es
// im Gespraech verfolgt (kurz) oder ueber Telegram zugestellt wird (lang).
function auftragStarten(text, history, was = "hermes") {
  const id = "a" + (++auftragZaehler) + "-" + Date.now().toString(36);
  const art = was === "hermes" ? "lang" : "kurz";
  AUFTRAEGE.set(id, { fertig: false, gestartet: Date.now(), was, art, auftragText: String(text).slice(0, 120) });
  // Zwischenstaende von Hermes im Auftrag mitfuehren (Stufe 2, 24.07.):
  // Der Browser fragt sie ab und laesst Alexandra unterwegs sagen, woran sie
  // gerade ist — aus dem ECHTEN Text, nicht aus Vermutungen.
  const melde = (teil) => {
    const e = AUFTRAEGE.get(id);
    if (e) { e.fortschritt = String(teil).slice(-1200); e.fortschrittAt = Date.now(); }
  };

  const lauf =
    was === "wetter" ? wetterAktion(text) :
    was === "mail" ? mailAktion(text) :
    was === "gehirn" ? gehirn.durchsuchen(text) :
    was === "wa_lesen" ? Promise.resolve(whatsapp.leseChat(text)) :
    was === "sonnet" ? denkAnfrage(text) :
    hermesAnfrage(modellHinweis(text), history, melde);   // Modellnamen absichern
  // Start protokollieren (Fix 24.07.): Bisher stand im Protokoll nur, wenn ein
  // Auftrag FERTIG wurde. Blieb er haengen, sah es aus, als haette es ihn nie
  // gegeben — genau das verdeckte, dass die PowerPoint-Aufgabe nie zurueckkam.
  sprachlog.schreiben({ art: "auftrag-start", was, id, auftrag: String(text).slice(0, 120) });

  const gestartet = Date.now();
  lauf.then((r) => {
    const eintrag = AUFTRAEGE.get(id);
    if (eintrag) Object.assign(eintrag, { fertig: true, ...r, dauerMs: Date.now() - eintrag.gestartet });
    sprachlog.schreiben({
      art: "auftrag", was, id,
      ok: r?.ok !== false,
      dauerMs: Date.now() - gestartet,
      hint: r?.hint || null,
      // Die Antwort selbst mitschreiben (Fix 25.07.): Bisher stand nur ihre
      // LAENGE im Protokoll. Bei "die Recherche stimmt nicht" liess sich damit
      // nicht beurteilen, ob das Ergebnis falsch war oder die Formulierung.
      antwort: typeof r?.reply === "string" ? r.reply.slice(0, 400) : null,
    });
    // Lange Arbeit stellt sich selbst zu — unabhaengig vom Browser.
    if (was === "hermes") zustellenPerTelegram(id, text, r);
    // Hat der Auftrag den Kalender angefasst, ist der STAND jetzt veraltet.
    // (Der Fall "Auftrag wirft" faellt unten in .catch — ohne das bliebe ein
    // Fehler stumm und der Auftrag haenge fuer immer auf "nicht fertig".)
    // Sofort neu lesen (Fix 24.07.) — sonst laeuft die naechste Frage in die
    // 5-Minuten-Luecke und Alexandra antwortet aus dem alten Kalender.
    if (r?.ok !== false && AENDERND.has(was) && betrifftKalender(text)) {
      zustand.bauen(null, ["kalender"])
        .then(() => sprachlog.schreiben({ art: "kalender-frisch", nach: id }))
        .catch(() => {});
    }
  }).catch((e) => {
    // OHNE dieses catch bleibt ein geworfener Auftrag fuer immer auf
    // "nicht fertig" stehen: der Browser fragt bis zum Abbruch nach, Lukas
    // bekommt nie eine Antwort, und im Protokoll steht nichts. Genau so sah
    // die haengende PowerPoint-Aufgabe am 24.07. aus. Jetzt endet JEDER
    // Auftrag sichtbar — im Zweifel mit einem ehrlichen Fehler.
    const eintrag = AUFTRAEGE.get(id);
    const hint = String(e?.message || e).slice(0, 200);
    if (eintrag) Object.assign(eintrag, { fertig: true, ok: false, hint, dauerMs: Date.now() - eintrag.gestartet });
    sprachlog.schreiben({ art: "auftrag", was, id, ok: false, dauerMs: Date.now() - gestartet, hint });
    // Auch das Scheitern wird zugestellt. Stille ist die schlechteste Antwort.
    if (was === "hermes") zustellenPerTelegram(id, text, { ok: false, hint });
  });
  // Aufraeumen, damit die Map nicht waechst. Grosszuegiger als das Timeout der
  // langen Arbeit (15 Min), damit ein Eintrag nicht verschwindet, waehrend er
  // noch laeuft.
  setTimeout(() => AUFTRAEGE.delete(id), 20 * 60 * 1000).unref?.();
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

    // Ankunft festhalten (A1, 26.07.). Bis hierher wurde die Wartezeit ueber die
    // Blitz-Zusage geschaetzt — die es jetzt nicht mehr gibt. Mit diesem Eintrag
    // misst scripts/messwerte.js "bis Inhalt kommt" exakt: von hier bis zum
    // fertigen Frage-Eintrag.
    sprachlog.schreiben({ art: "runde", frage: text.slice(0, 200) });

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
        // Gruppen werden ueber ihre JID adressiert ("<id>@g.us"), Personen ueber
        // die Nummer. Die Bruecke nimmt beides entgegen.
        const ziel = p.jid || p.nummer;
        const wohin = p.gruppe ? `die Gruppe ${p.name}` : p.name;
        const r = await whatsapp.senden({ an: ziel, text: p.text }).catch((e) => ({ ok: false, grund: String(e.message) }));
        // EHRLICH melden (Wunsch Lukas 22.07.: muss verlaesslich ankommen):
        // nur "angekommen" sagen, wenn die Bruecke zwei Haken bestaetigt hat.
        let sp, fakt;
        if (!r.ok) {
          sp = "Bei der WhatsApp hakt's gerade — die Verbindung scheint nicht gekoppelt zu sein.";
          fakt = `\n[FAKT: WhatsApp an ${wohin} FEHLGESCHLAGEN: ${r.grund || "unbekannt"}]`;
        } else if (p.gruppe) {
          // In Gruppen gibt es keine einzelne Zustellbestaetigung (viele
          // Empfaenger) — nicht nachfassen, sondern schlicht ehrlich melden.
          sp = `Ist in der Gruppe ${p.name} drin.`;
          fakt = `\n[FAKT: WhatsApp in Gruppe ${p.name} gesendet: "${p.text.slice(0, 150)}"]`;
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
        sprachlog.schreiben({ art: "wa-freigabe", an: p.name, ausgang: !r.ok ? "fehlgeschlagen" : r.zugestellt ? "zugestellt" : "gesendet", grund: r.grund || null });
        return res.json({ ok: true, sprich: sp, karten: [], auftraege: [], quelle: "zustand" });
      }
      if (/\b(nein|ne|n[oö]|nicht|lass|abbrech\w*|verwerf\w*|doch nicht|vergiss)\b/i.test(text)) {
        req.session.pendingWa = null;
        sprachlog.schreiben({ art: "wa-freigabe", an: p.name, ausgang: "verworfen" });
        return res.json({ ok: true, sprich: "Okay, hab ich verworfen.", karten: [], auftraege: [], quelle: "zustand" });
      }
      req.session.pendingWa = null; // neue Anweisung -> normal weiter
    }

    // Abgelaufene Teile auffrischen — und KURZ darauf warten (Fix 24.07.):
    // Vorher lief bauen() nur nebenher und die Antwort las noch den ALTEN
    // Stand vor (ein frisch eingetragener Termin fehlte, Zahlen hinkten nach).
    // Jetzt bekommt die Auffrischung ein Zeitbudget von 3,5 s — das faengt die
    // Blitz-Zusage ab, die parallel schon spricht. Schafft sie es nicht,
    // reden wir mit dem alten Stand weiter, statt das Gespraech anzuhalten.
    const alt = zustand.veraltet();
    const standStart = Date.now();
    let standFrisch = true;
    if (alt.length) {
      standFrisch = await Promise.race([
        zustand.bauen(req.session.crm, alt).then(() => true).catch(() => false),
        new Promise((ok) => setTimeout(() => ok(false), 3500)),
      ]);
    }
    const standMs = Date.now() - standStart;

    // Laufende Auftraege dieser Sitzung mitfuehren — und alte vergessen, damit
    // die Liste nicht waechst (fertige bleiben 5 Minuten, dann sind sie durch).
    req.session.laufend = (req.session.laufend || []).filter((id) => {
      const a = AUFTRAEGE.get(id);
      return a && (!a.fertig || Date.now() - a.gestartet < 300000);
    });

    const zustandText = zustand.alsText() + laufendText(req.session.laufend);
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
        antwort.text = antwort.text || "Die Mail bereite ich als Entwurf vor, du gibst sie frei.";
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
    // Fuer spaetere "wie schaut's aus?"-Fragen merken.
    req.session.laufend.push(...auftraege.map((a) => a.id));

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

    // EIN Satz aus EINER Quelle (A1, 26.07.). Die frueher vorangestellte
    // Zusage ist weg — sie war der Grund fuer das Dreifach-Sagen.
    let sprich = antwort.text || "";

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

    // Termin direkt eintragen (Phase 4, 25.07.) — statt ueber Hermes, der dafuer
    // 44 Sekunden brauchte. Wir warten hier bewusst darauf: Es dauert etwa eine
    // Sekunde, und danach ist die Rueckmeldung EHRLICH ("steht" heisst steht).
    let terminFakt = "";
    if (antwort.termin) {
      const tm = antwort.termin;
      const zeitWort = (iso, ganztags) => {
        const d = new Date(iso);
        return isNaN(d) ? "" : d.toLocaleString("de-DE", {
          timeZone: "Europe/Berlin", weekday: "long", day: "numeric", month: "long",
          ...(ganztags ? {} : { hour: "2-digit", minute: "2-digit" }),
        });
      };
      let erg = null, gefunden = null;

      if (tm.was === "eintragen") {
        erg = await werkzeuge.terminEintragen(tm).catch((e) => ({ ok: false, grund: String(e.message).slice(0, 200) }));
        if (erg.ok) {
          sprich = (sprich ? sprich + " " : "") + `Steht — ${tm.titel}, ${zeitWort(erg.start, tm.ganztags)}.`;
          terminFakt = `\n[FAKT: Termin "${tm.titel}" eingetragen: ${erg.start}]`;
        } else {
          sprich = (sprich ? sprich + " " : "") + "Beim Eintragen hat's gehakt — der Termin ist nicht drin.";
          terminFakt = `\n[FAKT: Termin "${tm.titel}" NICHT eingetragen: ${erg.grund}]`;
        }
      } else {
        // Verschieben/Absagen: erst den gemeinten Termin im Kalender finden.
        gefunden = terminFinden(tm.suche, zustand.lesen().kalender, tm.tag);
        if (!gefunden) {
          sprich = (sprich ? sprich + " " : "") +
            `Ich finde keinen Termin, der auf „${tm.suche || "das"}“ passt — sag mir kurz, welchen du meinst.`;
          terminFakt = `\n[FAKT: Termin "${tm.suche}" nicht gefunden — nichts geaendert.]`;
        } else if (gefunden.mehrdeutig) {
          const liste = gefunden.mehrdeutig.map((x) => `${x.titel} am ${zeitWort(x.start, false)}`).join(" oder ");
          sprich = (sprich ? sprich + " " : "") + `Da passen mehrere — ${liste}. Welchen meinst du?`;
          terminFakt = `\n[FAKT: mehrere Termine passen auf "${tm.suche}", Rueckfrage laeuft — nichts geaendert.]`;
        } else if (tm.was === "verschieben") {
          // titel MUSS mit (Fix 26.07.): "ich meinte nicht Schwimmen sondern
          // Fitnessstudio" liefert was="verschieben" + titel="Fitnessstudio".
          // Ohne das Feld wurde der Termin auf dieselbe Zeit "verschoben", der
          // Name blieb stehen — und weil das technisch klappte, kam eine
          // Erfolgsmeldung. Lukas hat es zweimal versucht, zweimal passierte
          // nichts. terminAendern kann den Titel laengst, er wurde nur nie
          // uebergeben.
          const neuerName = tm.titel && tm.titel !== gefunden.titel ? tm.titel : "";
          erg = await werkzeuge.terminAendern({
            id: gefunden.id, start: tm.start, ende: tm.ende, ort: tm.ort, titel: neuerName || undefined,
          }).catch((e) => ({ ok: false, grund: String(e.message).slice(0, 200) }));
          if (erg.ok) {
            // Sagen, was sich WIRKLICH geaendert hat — Umbenennen, Verschieben
            // oder beides. Vorher hiess es immer "Verschoben" und es wurde der
            // ALTE Titel genannt, auch wenn gerade umbenannt wurde.
            const satz = neuerName && tm.start
              ? `Geändert — aus ${gefunden.titel} wird ${neuerName}, jetzt ${zeitWort(erg.start, false)}.`
              : neuerName
                ? `Umbenannt — aus ${gefunden.titel} wird ${neuerName}.`
                : `Verschoben — ${gefunden.titel} ist jetzt ${zeitWort(erg.start, false)}.`;
            sprich = (sprich ? sprich + " " : "") + satz;
            terminFakt = `\n[FAKT: Termin "${gefunden.titel}"${neuerName ? ` umbenannt in "${neuerName}"` : ""}${tm.start ? ` verschoben auf ${erg.start}` : ""}]`;
          } else {
            sprich = (sprich ? sprich + " " : "") + "Das Verschieben hat nicht geklappt — der Termin steht noch wie vorher.";
            terminFakt = `\n[FAKT: Termin "${gefunden.titel}" NICHT verschoben: ${erg.grund}]`;
          }
        } else {
          erg = await werkzeuge.terminAbsagen({ id: gefunden.id })
            .catch((e) => ({ ok: false, grund: String(e.message).slice(0, 200) }));
          if (erg.ok) {
            sprich = (sprich ? sprich + " " : "") + `Abgesagt — ${gefunden.titel} ist raus.`;
            terminFakt = `\n[FAKT: Termin "${gefunden.titel}" abgesagt.]`;
          } else {
            sprich = (sprich ? sprich + " " : "") + "Das Absagen hat nicht geklappt — der Termin steht noch.";
            terminFakt = `\n[FAKT: Termin "${gefunden.titel}" NICHT abgesagt: ${erg.grund}]`;
          }
        }
      }

      // Hat sich etwas geaendert, ist der Kalender im STAND veraltet.
      if (erg?.ok) zustand.bauen(null, ["kalender"]).catch(() => {});
      sprachlog.schreiben({
        art: "termin", was: tm.was, ok: Boolean(erg?.ok),
        titel: tm.titel || gefunden?.titel || tm.suche,
        start: erg?.start || tm.start || null,
        grund: erg?.grund || (gefunden?.mehrdeutig ? "mehrdeutig" : (!gefunden && tm.was !== "eintragen" ? "nicht gefunden" : null)),
      });
    }

    // Aufgaben: anlegen oder abhaken (25.07.). Braucht das persoenliche Konto,
    // weil die Datenbank pro Person abriegelt (RLS) — mit dem gemeinsamen
    // Passwort allein geht das bewusst nicht.
    let aufgabeFakt = "";
    if (antwort.aufgabe) {
      const ag = antwort.aufgabe;
      const crm = require("./crm.js");
      if (!req.session.crm) {
        sprich = (sprich ? sprich + " " : "") + "Dafür musst du mit deinem eigenen Konto angemeldet sein.";
        aufgabeFakt = `\n[FAKT: Aufgabe nicht moeglich — keine persoenliche Anmeldung.]`;
      } else if (ag.was === "anlegen") {
        try {
          await crm.todoAnlegen(req.session.crm, { titel: ag.titel, faellig: ag.faellig, geplant_am: ag.geplant });
          sprich = (sprich ? sprich + " " : "") + `Steht auf der Liste: ${ag.titel}.`;
          aufgabeFakt = `\n[FAKT: Aufgabe "${ag.titel}" angelegt.]`;
          zustand.bauen(req.session.crm, ["crm"]).catch(() => {});
        } catch (e) {
          sprich = (sprich ? sprich + " " : "") + "Die Aufgabe konnte ich nicht anlegen.";
          aufgabeFakt = `\n[FAKT: Aufgabe "${ag.titel}" NICHT angelegt: ${String(e.message).slice(0, 120)}]`;
        }
      } else {
        // Abhaken: die gemeinte Aufgabe unter den offenen finden. Wie bei
        // Terminen wird bei mehreren Treffern gefragt, nicht geraten.
        const offen = (zustand.lesen().crm?.aufgaben || []).filter((a) => a.id);
        const treffer = terminFinden(ag.suche, offen.map((a) => ({ ...a, start: a.geplant_am || a.faellig || "" })));
        if (!treffer) {
          sprich = (sprich ? sprich + " " : "") + `Ich finde keine Aufgabe, die auf „${ag.suche}“ passt.`;
          aufgabeFakt = `\n[FAKT: Aufgabe "${ag.suche}" nicht gefunden.]`;
        } else if (treffer.mehrdeutig) {
          sprich = (sprich ? sprich + " " : "") +
            `Da passen mehrere — ${treffer.mehrdeutig.map((x) => x.titel).join(" oder ")}. Welche meinst du?`;
          aufgabeFakt = `\n[FAKT: mehrere Aufgaben passen auf "${ag.suche}" — nichts geaendert.]`;
        } else {
          try {
            await crm.todoErledigt(req.session.crm, treffer.id, true);
            sprich = (sprich ? sprich + " " : "") + `Abgehakt: ${treffer.titel}.`;
            aufgabeFakt = `\n[FAKT: Aufgabe "${treffer.titel}" erledigt.]`;
            zustand.bauen(req.session.crm, ["crm"]).catch(() => {});
          } catch (e) {
            sprich = (sprich ? sprich + " " : "") + "Das Abhaken hat nicht geklappt.";
            aufgabeFakt = `\n[FAKT: Aufgabe "${treffer.titel}" NICHT erledigt: ${String(e.message).slice(0, 120)}]`;
          }
        }
      }
      sprachlog.schreiben({ art: "aufgabe", was: ag.was, titel: ag.titel || ag.suche, ok: !/NICHT|nicht/.test(aufgabeFakt) });
    }

    // CRM-Arbeit (25.07.): Lead, Notiz, Wiedervorlage, Anrufergebnis. Die
    // Handgriffe stecken in lib/crm-sprache.js — dort ist auch abgesichert, was
    // crm.callErgebnis von sich aus falsch macht: Es kennt nur vier Ausgaenge,
    // meldet bei jedem anderen Wort aber Erfolg (Alexandra haette "notiert"
    // gesagt und im CRM stuende nichts), und "spaeter" ohne Datum LOESCHT eine
    // bestehende Wiedervorlage.
    let crmFakt = "";
    if (antwort.crm) {
      const c = antwort.crm;
      const cs = require("./crm-sprache.js");
      const nutzer = req.session.crm;
      let r;
      if (c.was === "lead") r = await cs.leadAnlegen(nutzer, { name: c.firma, quelle: c.quelle, ort: c.ort, telefon: c.telefon, email: c.email, notiz: c.notiz });
      else if (c.was === "notiz") r = await cs.notizAnlegen(nutzer, { firma: c.firma, text: c.text || c.notiz });
      else if (c.was === "wiedervorlage") r = await cs.wiedervorlageSetzen(nutzer, { firma: c.firma, datum: c.datum, notiz: c.notiz });
      else r = await cs.anrufErgebnis(nutzer, { firma: c.firma, ausgang: c.ausgang, notiz: c.notiz, grund: c.grund, datum: c.datum });

      if (r.ok) {
        const satz = c.was === "lead" ? `Lead angelegt: ${r.name}.${r.dublette ? " Achtung, so eine Firma gab's schon — jetzt steht sie zweimal drin." : ""}`
          : c.was === "notiz" ? `Notiert bei ${r.firma.name}.`
          : c.was === "wiedervorlage" ? `Wiedervorlage bei ${r.firma.name} steht.`
          : `Festgehalten bei ${r.firma.name}.`;
        sprich = (sprich ? sprich + " " : "") + satz;
        crmFakt = `\n[FAKT: CRM ${c.was} erledigt fuer ${r.name || r.firma?.name}.]`;
        zustand.bauen(nutzer, ["crm"]).catch(() => {});
      } else if (r.mehrdeutig) {
        const liste = r.mehrdeutig.map((f) => f.ort ? `${f.name} in ${f.ort}` : f.name).join(" oder ");
        sprich = (sprich ? sprich + " " : "") + `Da passen mehrere — ${liste}. Welche meinst du?`;
        crmFakt = `\n[FAKT: CRM ${c.was} nicht ausgefuehrt — mehrere Firmen passen auf "${c.firma}".]`;
      } else if (r.unbekannt) {
        sprich = (sprich ? sprich + " " : "") + `${c.firma} kenne ich nicht — soll ich sie als Lead anlegen?`;
        crmFakt = `\n[FAKT: CRM ${c.was} nicht ausgefuehrt — Firma "${c.firma}" unbekannt.]`;
      } else {
        sprich = (sprich ? sprich + " " : "") + `Das hat im CRM nicht geklappt: ${r.grund}.`;
        crmFakt = `\n[FAKT: CRM ${c.was} FEHLGESCHLAGEN: ${r.grund}]`;
      }
      sprachlog.schreiben({ art: "crm", was: c.was, firma: c.firma, ok: Boolean(r.ok), grund: r.grund || null });
    }

    // WhatsApp: NIE sofort senden (Wunsch Lukas 22.07.). Sonnet formuliert die
    // Nachricht in Lukas' Ton aus, liest sie vor und fragt nach Freigabe. Erst
    // ein "ja" (oben abgefangen) schickt sie raus. Gilt fuer JEDEN Empfaenger.
    let waFakt = "";
    if (antwort.whatsapp && antwort.whatsapp.text) {
      const ziel = empfaengerFinden(antwort.whatsapp.an, antwort.whatsapp.gruppe);
      if (ziel?.mehrdeutig) {
        // Lieber einmal nachfragen als an die falsche Person schreiben —
        // eine verschickte WhatsApp holt niemand zurueck (Fix 24.07.).
        const namen = ziel.mehrdeutig.map((k) => k.name).filter(Boolean);
        sprich = (sprich ? sprich + " " : "") +
          `Bei ${antwort.whatsapp.an} hab ich mehrere — ${namen.join(" und ")}. Welchen meinst du?`;
        waFakt = `\n[FAKT: WhatsApp NICHT gesendet — mehrere Treffer fuer "${antwort.whatsapp.an}", Rueckfrage laeuft.]`;
      } else if (!ziel || !(ziel.nummer || ziel.jid)) {
        // Bei Gruppen ehrlich sagen, dass sie nicht freigegeben ist — sonst
        // sucht Lukas den Fehler bei WhatsApp statt in der Freigabeliste.
        const alsGruppe = antwort.whatsapp.gruppe || /gruppe/i.test(antwort.whatsapp.an || "");
        sprich = (sprich ? sprich + " " : "") + (alsGruppe
          ? `Die Gruppe ${antwort.whatsapp.an} ist bei mir nicht freigegeben — nur die Arbeitsgruppen sind es.`
          : `Für ${antwort.whatsapp.an || "den Kontakt"} hab ich keine WhatsApp-Nummer — gib sie mir, dann bereite ich's vor.`);
        waFakt = `\n[FAKT: WhatsApp an ${antwort.whatsapp.an} nicht moeglich — ${alsGruppe ? "Gruppe nicht freigegeben" : "keine Nummer"}.]`;
      } else {
        const nachricht = await komponiere(ziel.gruppe ? "WhatsApp-Gruppen" : "WhatsApp", ziel.name, antwort.whatsapp.text);
        req.session.pendingWa = {
          name: ziel.name, nummer: ziel.nummer || null, jid: ziel.jid || null,
          gruppe: Boolean(ziel.gruppe), text: nachricht,
        };
        sprich = (sprich ? sprich + " " : "") + (ziel.gruppe
          ? `In die Gruppe ${ziel.name} würd ich schreiben: „${nachricht}“ — soll ich's abschicken?`
          : `An ${ziel.name} würd ich schreiben: „${nachricht}“ — soll ich's abschicken?`);
        waFakt = `\n[FAKT: WhatsApp an ${ziel.gruppe ? "Gruppe " : ""}${ziel.name} vorbereitet, wartet auf Freigabe: "${nachricht.slice(0, 150)}"]`;
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
    // Verlaufs-Marker fuer noch laufende Arbeit (Fix 24.07.): Ohne ihn wurde
    // Alexandras eigene Ankuendigung ("trag ich ein") beim naechsten Mal als
    // Tatsache vorgelesen — sie las einen Termin vor, den Hermes noch gar
    // nicht angelegt hatte. Der Marker wird aufgeloest, sobald das Ergebnis da
    // ist (siehe /api/sprache/auftrag/:id).
    const laeuft = auftraege
      .filter((a) => AENDERND.has(a.was))
      .map((a) => `\n[LAEUFT NOCH #${a.id}: ${AUFTRAEGE.get(a.id)?.auftragText || "Auftrag"} — noch NICHT bestaetigt, nicht als erledigt vorlesen]`)
      .join("");

    history.push({ role: "user", content: text });
    if (sprich) history.push({ role: "assistant", content: sprich + mailFakt + waFakt + terminFakt + aufgabeFakt + crmFakt + laeuft });
    if (history.length > 20) history.splice(0, history.length - 20);

    const quelle = auftraege.some((a) => a.was === "hermes") ? "hermes"
      : auftraege[0]?.was || "zustand";

    sprachlog.schreiben({
      art: "frage",
      frage: text,
      stand: { aufgefrischt: alt, frisch: standFrisch, dauerMs: standMs },
      verstehen: antwort._diag || null,
      gesagt: sprich.slice(0, 600),
      aktionen: auftraege.map((a) => a.was),
      mail: antwort.mail ? antwort.mail.an : null,
      whatsapp: antwort.whatsapp ? antwort.whatsapp.an : null,
      karten: karten.map((k) => k.art),
      quelle,
      gesamtMs: Date.now() - jetztMs,
    });

    res.json({ ok: true, sprich, karten, auftraege, auftragId: auftraege[0]?.id || null, quelle });
  });

  // ENTFERNT am 26.07.2026 (Schritt A1): Blitz-Zusage und Erzaehlspur.
  //
  // Gemessen an 60 Runden vom 24./25.07.: median 3 Sprechakte pro Frage, max 13.
  // Drei Stellen sprachen unabhaengig voneinander und wussten nichts voneinander:
  // die Blitz-Zusage (Haiku), das "zusage"-Feld aus Sonnet und die Bestaetigung
  // vom Server. Fuer EINE Terminverschiebung kam so:
  //
  //   "Mach ich, schieb den gleich auf acht Uhr frueh."
  //   "Verschieb dir den Termin morgen auf acht Uhr."
  //   "Verschoben — Ganz schlimm gehen ist jetzt Sonntag, 26. Juli um 08:00."
  //
  // Die Zusage war ein Pflaster fuer die 4,89 s Wartezeit, die entstehen, weil
  // die Antwort nicht streamt (schnell.js ruft mit stream:false auf und muss bis
  // zu 900 Token JSON fertig haben, bevor ein Ton kommt). Das Pflaster hat das
  // Wiederholen verursacht. A4 nimmt die Ursache weg — natives Tool-Calling
  // statt JSON-Formular, dann streamt die Antwort und es gibt nichts mehr zu
  // ueberbruecken.
  //
  // Die Vorbilder machen es genauso: "One request, one tool", und keine
  // Fuell-Ansage. Sie brauchen sie nicht, weil nichts zu ueberbruecken ist.
  //
  // Wiederherstellbar aus Commit 6b11e48.

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
      } catch (e) {
        a.gesprochen = a.reply; // besser roh als stumm
        sprachlog.schreiben({ art: "umformulierung", ok: false, was: a.was, fehler: String(e.message).slice(0, 200) });
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
    // "laeuft noch" -> bestaetigter Fakt (oder ehrliches Scheitern).
    markerAufloesen(history, req.params.id, a.ok !== false && Boolean(a.reply), a.auftragText);
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
    const start = Date.now();
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
        sprachlog.schreiben({ art: "stimme", ok: false, zeichen: text.length, dauerMs: Date.now() - start, fehler: fehler.slice(0, 200) });
        return res.status(502).json({ ok: false, hint: "ElevenLabs: " + fehler.slice(0, 200) });
      }
      sprachlog.schreiben({ art: "stimme", ok: true, zeichen: text.length, dauerMs: Date.now() - start });
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Cache-Control", "no-store");
      const { Readable } = require("stream");
      Readable.fromWeb(r.body).pipe(res);
    } catch (e) {
      sprachlog.schreiben({ art: "stimme", ok: false, zeichen: text.length, dauerMs: Date.now() - start, fehler: String(e.message).slice(0, 200) });
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

// Fuer Tests (scripts/test-sprache.js) — die Route selbst braucht das nicht.
module.exports.ausZustand = ausZustand;
module.exports.markerAufloesen = markerAufloesen;
module.exports.betrifftKalender = betrifftKalender;
module.exports.hermesStream = hermesStream;
module.exports.empfaengerFinden = empfaengerFinden;
module.exports.terminFinden = terminFinden;
module.exports.AUFTRAEGE = AUFTRAEGE;

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
    <button id="btn-pause" class="vx-tool" type="button"
            title="Mikro pausieren — sie bleibt ansprechbereit, hört aber nicht zu">Pause</button>
    <button id="btn-stop" class="vx-tool" type="button" title="Gespräch beenden">Stopp</button>
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

/* Pause: Mikro aus, aber sie ist da — ruhiges Grau, alles steht still.
   Bewusst anders als "ruhe": die Kugel bleibt sichtbar wach, nur ohne Ohren. */
.voix-orb[data-zustand="pause"]{--vx:#8a97a6}
.voix-orb[data-zustand="pause"] .pegel{opacity:.12}
.voix-orb[data-zustand="pause"] .vx-kern{opacity:.34}
.voix-orb[data-zustand="pause"] .voix-bloom{opacity:.22;animation:none}
.voix-orb[data-zustand="pause"] .voix-cue{opacity:1}

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
/* "an" = Pause laeuft gerade — der Knopf zeigt dann "Weiter". */
.vx-tool.an{background:rgba(255,255,255,.16);color:#fff;font-weight:600}
.vx-dot{width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,.3);transition:background .3s,box-shadow .3s}
.vx-dot.an{background:#35e3cf;box-shadow:0 0 10px #35e3cf}
.vx-voice{font-size:11px;letter-spacing:.05em;color:rgba(224,240,245,.4);padding-right:6px}
</style>

<!-- Bedienlogik: /public/sprache.js (dieselbe Datei ueberall via Schale). -->
`;
}
