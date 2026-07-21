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
 "text": "<was du jetzt sagst>",
 "mail": {"an": "<adresse>", "betreff": "<betreff>", "body": "<voller Mailtext>"} oder null,
 "braucht_hermes": false,
 "hermes_auftrag": "<falls braucht_hermes: EIN fokussierter Arbeitsauftrag, nur der Teil fuer Hermes>",
 "zeige": ["kalender"|"zahlen"]}

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
braucht: lass "mail" null, setze braucht_hermes=true und formuliere den
hermes_auftrag. Du kannst externe Mails NICHT selbst verschicken — die
brauchen Hermes (Verlauf lesen) und Lukas' Freigabe.

NICHT WIEDERHOLEN: BISHER zeigt, was du schon gesagt hast. Antworte NUR auf
die letzte Aeusserung. Termine oder Zahlen, die du schon vorgelesen hast,
nennst du NICHT erneut — ausser Lukas fragt ausdruecklich nochmal danach.
Geht es in der letzten Aeusserung nur um die Mail, redest du nur ueber die Mail.

"braucht_hermes" ist true, wenn ueber Zusage/text/mail hinaus etwas zu TUN
bleibt (Recherche, externe Mail, Termin eintragen) ODER der STAND nicht reicht.
"text" nur leer lassen, wenn du wirklich nichts beantworten kannst.

HERMES_AUFTRAG: Wenn braucht_hermes, gib Hermes NUR den Arbeitsteil als klaren
Auftrag — nicht die ganze Aeusserung. Lukas fragt "was steht morgen an und
antworte Krotzer auf sein Angebot" -> du liest die Termine selbst vor (text),
hermes_auftrag ist NUR "Antworte auf die Mail von Krotzer zu seinem Angebot,
in Lukas' Ton". So bearbeitet Hermes nicht doppelt den Kalender und ist
schneller. Betrifft es eine Mail, weise Hermes an, sie im Ton von Lukas zu
verfassen (kein AI-Slop) und als Entwurf vorzubereiten.`;

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
    if (!m) return { zusage: "", text: roh.slice(0, 500), mail: null, braucht_hermes: false, zeige: [] };
    const p = JSON.parse(m[0]);
    const mail = p.mail && p.mail.an && p.mail.betreff
      ? { an: String(p.mail.an).trim(), betreff: String(p.mail.betreff).slice(0, 200), body: String(p.mail.body || "") }
      : null;
    return {
      zusage: String(p.zusage || "").slice(0, 300),
      text: String(p.text || "").slice(0, 900),
      mail,
      braucht_hermes: Boolean(p.braucht_hermes),
      hermes_auftrag: String(p.hermes_auftrag || "").slice(0, 600),
      zeige: Array.isArray(p.zeige) ? p.zeige : [],
    };
  } catch {
    // Im Zweifel lieber langsam und richtig als schnell und daneben.
    return { zusage: "", text: "", mail: null, braucht_hermes: true, hermes_auftrag: "", zeige: [] };
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

// Laufende Hintergrundauftraege. Der Browser fragt sie per /api/sprache/auftrag ab,
// waehrend er die schnelle Antwort vorliest.
const AUFTRAEGE = new Map();
let auftragZaehler = 0;

function auftragStarten(text, history) {
  const id = "a" + (++auftragZaehler) + "-" + Date.now().toString(36);
  AUFTRAEGE.set(id, { fertig: false, gestartet: Date.now() });
  hermesAnfrage(text, history).then((r) => {
    const eintrag = AUFTRAEGE.get(id);
    if (eintrag) Object.assign(eintrag, { fertig: true, ...r, dauerMs: Date.now() - eintrag.gestartet });
  });
  // Nach 10 Minuten aufraeumen, damit die Map nicht waechst.
  setTimeout(() => AUFTRAEGE.delete(id), 600000).unref?.();
  return id;
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

    const history = (req.session.sprache ||= []);

    // Abgelaufene Teile im Hintergrund auffrischen — kostet keine Token,
    // sind nur SQL und ein gws-cli-Aufruf.
    const alt = zustand.veraltet();
    if (alt.length) zustand.bauen(req.session.crm, alt).catch(() => {});

    const zustandText = zustand.alsText();
    const antwort = await ausZustand(text, zustandText, history.slice(-6));

    let auftragId = null;
    const karten = [];

    // Mail nur dann direkt senden, wenn der Empfaenger INTERN ist (Whitelist).
    // Schlaegt Haiku faelschlich eine externe Mail vor, wird sie NICHT gesendet,
    // sondern als fokussierter Auftrag an Hermes umgeleitet (Verlauf lesen +
    // Freigabe). Doppelt abgesichert: werkzeuge.mailSenden riegelt Externe auch
    // selbst ab. So kann keine ungefragte Mail an einen Kunden rausgehen.
    let mailLauf = null;
    let hermesAuftrag = antwort.braucht_hermes ? (antwort.hermes_auftrag || text) : "";
    if (antwort.mail) {
      if (werkzeuge.istIntern(antwort.mail.an)) {
        mailLauf = werkzeuge.mailSenden(antwort.mail)
          .then((r) => r).catch((e) => ({ ok: false, fehler: String(e.message).slice(0, 200) }));
      } else {
        // Extern durchgereicht -> nicht senden, an Hermes zum Entwurf.
        hermesAuftrag = hermesAuftrag ||
          `Verfasse als Entwurf eine Mail an ${antwort.mail.an}, Betreff "${antwort.mail.betreff}", ` +
          `in Lukas' Ton (kein AI-Slop). Sende NICHT — lege sie als Entwurf an. Inhalt: ${antwort.mail.body}`;
        antwort.zusage = antwort.zusage || "Die Mail bereite ich als Entwurf vor, du gibst sie frei.";
      }
    }

    // Echte Arbeit (Recherche, externe Mail) an Hermes — ebenfalls parallel.
    // Fokussierter Auftrag statt Roh-Aeusserung: Hermes bearbeitet nur den
    // Arbeitsteil, nicht nochmal den Kalender, den Alexandra schon vorliest.
    if (hermesAuftrag) {
      auftragId = auftragStarten(hermesAuftrag, history.slice(-10));
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

    if (auftragId && !antwort.zusage) {
      sprich = sprich ? sprich + " Um den Rest kümmere ich mich, sag dir gleich Bescheid." : "Einen Moment.";
    }

    // Beides in den Verlauf: Frage UND was Alexandra geantwortet hat. Damit
    // sieht das Modell beim naechsten Mal, was schon gesagt wurde, und liest
    // Termine/Zahlen nicht erneut vor (Fix fuer "immer wieder Kalender").
    // Der [FAKT]-Marker groundet Nachfragen ("war die Mail raus?") — ohne ihn
    // zweifelt das Modell seinen eigenen "ist raus"-Satz an (rate nie).
    history.push({ role: "user", content: text });
    if (sprich) history.push({ role: "assistant", content: sprich + mailFakt });
    if (history.length > 20) history.splice(0, history.length - 20);

    res.json({ ok: true, sprich, karten, auftragId, quelle: antwort.braucht_hermes ? "hermes" : "zustand" });
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

    if (a.reply && !a.gesprochen) {
      try {
        a.gesprochen = await schnell.frage(
          stimmeLaden() +
            "\n\n## Aufgabe\nFormuliere das folgende Arbeitsergebnis fuers Sprechen um. " +
            "Nur das Ergebnis in 1-3 Saetzen nach deinen Hoerregeln — keine Adressen, " +
            "keine Betreffzeilen, keine Kopfzeilen. Endet das Original mit einer Frage " +
            "(z. B. ob gesendet werden soll), stelle sie kurz.",
          a.reply,
          { maxTokens: 250, temp: 0.4 }
        );
      } catch {
        a.gesprochen = a.reply; // besser roh als stumm
      }
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
          model_id: process.env.ELEVENLABS_MODEL || "eleven_flash_v2_5",
          voice_settings: { stability: 0.45, similarity_boost: 0.8, speed: 1.05 },
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
  return `
<div class="sprache-buehne">
  <div class="kugel-feld">
    <div id="kugel" class="kugel" data-zustand="ruhe" role="button" tabindex="0"
         aria-label="Sprechen — halten oder klicken">
      <svg viewBox="0 0 220 220" class="kugel-svg">
        <defs>
          <radialGradient id="kern-g" cx="50%" cy="50%" r="50%">
            <stop offset="0%"  stop-color="var(--primary)" stop-opacity=".95"/>
            <stop offset="60%" stop-color="var(--primary)" stop-opacity=".35"/>
            <stop offset="100%" stop-color="var(--primary)" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <circle class="ring ring-3" cx="110" cy="110" r="96"/>
        <circle class="ring ring-2" cx="110" cy="110" r="80"/>
        <circle class="ring ring-1" cx="110" cy="110" r="64"/>
        <circle class="kern" cx="110" cy="110" r="46" fill="url(#kern-g)"/>
        <g class="balken-gruppe">
          ${Array.from({ length: 32 }, (_, i) => {
            const a = (i / 32) * Math.PI * 2;
            const r1 = 52, r2 = 60;
            const x1 = 110 + Math.cos(a) * r1, y1 = 110 + Math.sin(a) * r1;
            const x2 = 110 + Math.cos(a) * r2, y2 = 110 + Math.sin(a) * r2;
            return `<line class="pegel" data-i="${i}" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}"
                     x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
          }).join("")}
        </g>
      </svg>
      <div class="kugel-mitte"><span id="kugel-wort">ALEXANDRA</span></div>
    </div>
    <div class="kugel-zustand"><span id="zustand-punkt"></span><span id="zustand-text">bereit</span></div>
    <div class="kugel-hinweis" id="kugel-hinweis">Klick auf die Kugel oder sag „Hey Alexandra“</div>
  </div>

  <div class="sprache-seite">
    <div class="sprache-leiste">
      <button id="btn-wake" class="still" type="button" title="Dauerhaft auf das Wake-Word lauschen">
        <span class="punkt" id="wake-punkt"></span> Wake-Word
      </button>
      <button id="btn-stop" class="still" type="button" title="Sprechen abbrechen">Stopp</button>
      <button id="btn-frisch" class="still" type="button" title="Kalender und CRM-Zahlen neu einlesen">Zustand auffrischen</button>
      <a class="still" href="/api/sprache/zustand" target="_blank" title="Ansehen, was Alexandra gerade weiß">Zustand ansehen</a>
      <span class="caption" id="stimme-info"></span>
    </div>
    <div id="karten" class="sprache-karten"></div>
    <div id="verlauf" class="sprache-verlauf"></div>
  </div>
</div>

<style>
.sprache-buehne{display:grid;grid-template-columns:minmax(280px,380px) 1fr;gap:28px;align-items:start}
@media (max-width:900px){.sprache-buehne{grid-template-columns:1fr}}

.kugel-feld{display:flex;flex-direction:column;align-items:center;gap:14px;
  padding:28px 18px;background:var(--surface);border:1px solid var(--border);border-radius:var(--r-lg)}
.kugel{position:relative;width:260px;height:260px;cursor:pointer;user-select:none;
  display:grid;place-items:center;transition:transform var(--tempo)}
.kugel:active{transform:scale(.98)}
.kugel-svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}

.ring{fill:none;stroke:var(--border-stark);stroke-width:1;opacity:.55;
  transform-origin:110px 110px;transition:stroke var(--tempo),opacity var(--tempo)}
.ring-1{stroke-dasharray:3 9}
.ring-2{stroke-dasharray:1 14;opacity:.4}
.ring-3{stroke-dasharray:22 10;opacity:.25}
.kern{opacity:.5;transform-origin:110px 110px;transition:opacity var(--tempo)}
.pegel{stroke:var(--primary);stroke-width:2.5;stroke-linecap:round;opacity:.18;
  transform-origin:110px 110px;transition:opacity var(--tempo)}

.kugel-mitte{position:relative;z-index:2;font-size:12px;letter-spacing:.22em;
  font-weight:700;color:var(--text-muted);transition:color var(--tempo)}

/* Ruhe — leises Atmen, damit die Seite nicht tot wirkt */
.kugel[data-zustand="ruhe"] .ring-1{animation:dreh 44s linear infinite}
.kugel[data-zustand="ruhe"] .kern{animation:atmen 5.5s ease-in-out infinite}

/* Lauschen — Ringe drehen schneller, Pegel reagieren auf das Mikrofon */
.kugel[data-zustand="lauschen"] .ring{stroke:var(--primary);opacity:.7}
.kugel[data-zustand="lauschen"] .ring-1{animation:dreh 9s linear infinite}
.kugel[data-zustand="lauschen"] .ring-2{animation:dreh 16s linear infinite reverse}
.kugel[data-zustand="lauschen"] .pegel{opacity:.85}
.kugel[data-zustand="lauschen"] .kugel-mitte{color:var(--primary)}
.kugel[data-zustand="lauschen"] .kern{opacity:.85}

/* Denken — Ring laeuft als Segment um, Kern pulsiert nervoeser */
.kugel[data-zustand="denken"] .ring-2{stroke:var(--warning);opacity:.9;
  stroke-dasharray:60 440;animation:dreh 1.15s linear infinite}
.kugel[data-zustand="denken"] .ring-1{animation:dreh 20s linear infinite reverse}
.kugel[data-zustand="denken"] .kern{animation:atmen 1.5s ease-in-out infinite}
.kugel[data-zustand="denken"] .kugel-mitte{color:var(--warning)}

/* Sprechen — Pegel tanzen zur Stimme */
.kugel[data-zustand="sprechen"] .ring{stroke:var(--success);opacity:.6}
.kugel[data-zustand="sprechen"] .ring-3{animation:dreh 28s linear infinite}
.kugel[data-zustand="sprechen"] .pegel{stroke:var(--success);opacity:.9}
.kugel[data-zustand="sprechen"] .kugel-mitte{color:var(--success)}
.kugel[data-zustand="sprechen"] .kern{opacity:.9}

@keyframes dreh{to{transform:rotate(360deg)}}
@keyframes atmen{0%,100%{opacity:.45;transform:scale(1)}50%{opacity:.9;transform:scale(1.07)}}
@media (prefers-reduced-motion:reduce){
  .ring,.kern,.pegel{animation:none!important}
}

.kugel-zustand{display:flex;align-items:center;gap:8px;font-size:12.5px;
  letter-spacing:.14em;text-transform:uppercase;font-weight:600;color:var(--text-secondary)}
#zustand-punkt{width:7px;height:7px;border-radius:50%;background:var(--text-muted);transition:background var(--tempo)}
.kugel[data-zustand="lauschen"] ~ .kugel-zustand #zustand-punkt{background:var(--primary)}
.kugel-hinweis{font-size:12.5px;color:var(--text-muted);text-align:center}

.sprache-leiste{display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap}
.sprache-leiste .punkt{display:inline-block;width:7px;height:7px;border-radius:50%;
  background:var(--text-muted);margin-right:6px;vertical-align:middle}
.sprache-leiste .punkt.an{background:var(--success)}

.sprache-karten{display:grid;gap:12px;margin-bottom:18px}
.sk{background:var(--surface);border:1px solid var(--border);border-radius:var(--r-md);
  padding:16px 18px;animation:karte-rein .32s cubic-bezier(.2,.8,.2,1)}
@keyframes karte-rein{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
.sk h3{margin:0 0 10px;font-size:14px;letter-spacing:.02em}
.sk table{width:100%;border-collapse:collapse;font-size:14px}
.sk td{padding:7px 0;border-bottom:1px solid var(--border)}
.sk tr:last-child td{border-bottom:none}
.sk td.zeit{width:104px;color:var(--text-secondary);font-variant-numeric:tabular-nums}
.sk .leer{color:var(--text-muted);font-size:14px}

.sprache-verlauf{display:flex;flex-direction:column;gap:8px}
.sv{padding:10px 14px;border-radius:var(--r-md);font-size:14px;max-width:86%}
.sv.ich{align-self:flex-end;background:var(--primary-soft);color:var(--foreground)}
.sv.sie{align-self:flex-start;background:var(--surface-2);border:1px solid var(--border)}
.sv.warte{opacity:.65;font-style:italic}
.sv-quelle{display:block;margin-top:6px;font-size:11px;letter-spacing:.08em;
  text-transform:uppercase;color:var(--text-muted)}
</style>

<!-- Die Bedienlogik steht in /public/sprache.js — dieselbe Datei laeuft ueber
     die Schale auf jeder Seite, damit "Hey Alexandra" ueberall funktioniert. -->
`;
}
