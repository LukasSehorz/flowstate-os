// lib/posteingang.js — Mail-Zufluss ins zweite Gehirn (nur Geschaeftliches).
//
// Liest regelmaessig den Posteingang und schreibt NEUE, geschaeftlich relevante
// Mails mit VOLLTEXT in eine Tagesnotiz eingang/mail/YYYY-MM-DD.md. Ueber die
// Zeit entsteht ein durchsuchbares Mail-Gedaechtnis, auf das Alexandra jederzeit
// zugreift (auch mobil, weil es ueber Git synct).
//
// Entscheidung Lukas 22.07.: NUR geschaeftliche Mails (Kundenanfragen, Partner,
// Firmen-/Rechnungssachen) — KEINE Werbung, Newsletter, Massenmails, Spam.
// Haiku klassifiziert jede neue Mail; nur die Wichtigen werden mit Volltext
// abgeholt und gespeichert. Dedupliziert ueber die Message-ID.

const { execFile } = require("child_process");
const vault = require("./vault.js");
const schnell = require("./schnell.js");

const GWS_ENV = { ...process.env, GWS_ENCRYPTION: "none" };

function gws(args, timeoutMs = 25000) {
  return new Promise((ok, fehler) => {
    execFile("gws-cli", args, { env: GWS_ENV, timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) return fehler(new Error(String(stderr || err.message).slice(0, 300)));
      ok(String(stdout || ""));
    });
  });
}

function envelopeDaten(out) {
  const o = JSON.parse(out);
  const roh = o?.messages?.data ?? o?.data ?? "[]";
  const liste = typeof roh === "string" ? JSON.parse(roh) : roh;
  return Array.isArray(liste) ? liste : [];
}

const berlinDatum = (ts) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date(ts));

function istRauschen(m) {
  const from = String(m.from || "").toLowerCase();
  const subj = String(m.subject || "").toLowerCase();
  return from.includes("mailer-daemon") || subj.includes("delivery status notification");
}

function zeitKurz(datum) {
  const ts = Date.parse(datum);
  if (Number.isNaN(ts)) return "";
  return new Date(ts).toLocaleString("de-DE",
    { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// Haiku sortiert: nur geschaeftlich Relevantes behalten. Bei Modell-Aussetzer
// lieber behalten als eine echte Kundenmail verlieren.
async function klassifiziere(mails) {
  if (!mails.length || !schnell.verfuegbar()) return mails;
  const liste = mails.map((m, i) =>
    `${i + 1}. Von: ${m.from} | Betreff: ${m.subject} | ${String(m.snippet || "").replace(/\s+/g, " ").slice(0, 140)}`
  ).join("\n");
  const system =
    "Du sortierst Lukas' Firmen-Posteingang fuers Wissens-Archiv. BEHALTE nur " +
    "geschaeftlich relevante Mails: echte Kundenanfragen, Nachrichten von Interessenten, " +
    "Partnern, Lieferanten, Bewerbern; geschaeftliche Korrespondenz; wichtige Konto-, " +
    "Rechnungs-, Vertrags- oder Domainsachen zum Unternehmen. VERWIRF: Werbung, Newsletter, " +
    "Marketing, Massenmails, Social-Media-Benachrichtigungen, automatische System-/" +
    "Zustellmeldungen, Test-/Eigenmails, offensichtlichen Spam. Antworte NUR mit einem " +
    "JSON-Array der Nummern, die behalten werden (z. B. [1,3]). Nichts sonst.";
  try {
    const roh = await schnell.frage(system, liste, { maxTokens: 120, temp: 0 });
    const keep = new Set(JSON.parse((roh.match(/\[[\d,\s]*\]/) || ["[]"])[0]).map(Number));
    return mails.filter((_, i) => keep.has(i + 1));
  } catch {
    return mails; // im Zweifel behalten
  }
}

// Volltext einer Mail holen (gws read), HTML grob entfernen, deckeln.
async function mailVolltext(id) {
  try {
    const o = JSON.parse(await gws(["gmail", "read", id], 20000));
    let body = String(o?.body?.data ?? "");
    body = body
      .replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
      .replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    return body.slice(0, 3000);
  } catch { return ""; }
}

function mailBlock(m) {
  const von = String(m.from || "unbekannt").replace(/["']/g, "").trim();
  const betreff = String(m.subject || "(ohne Betreff)").trim();
  const text = (m._text && m._text.length > 10)
    ? m._text
    : String(m.snippet || "").replace(/\s+/g, " ").trim().slice(0, 300);
  return `## ${betreff}\n- **Von:** ${von}\n- **Zeit:** ${zeitKurz(m.date)}\n\n${text}\n\n<!-- id:${m.id} -->\n\n`;
}

async function erfassen({ max = 30, tage = 3 } = {}) {
  if (!vault.schreibbar("eingang")) return { ok: false, grund: "eingang nicht beschreibbar (Mount :ro?)." };

  let liste;
  try { liste = envelopeDaten(await gws(["gmail", "search", "in:inbox newer_than:" + tage + "d", "--max", String(max)])); }
  catch (e) { return { ok: false, grund: String(e.message).slice(0, 150) }; }

  // Kandidaten sammeln: kein Rauschen, mit Datum, noch nicht in seiner Tagesnotiz.
  const proTag = {};
  for (const m of liste) {
    if (!m.id || istRauschen(m)) continue;
    const ts = Date.parse(m.date);
    if (Number.isNaN(ts)) continue;
    (proTag[berlinDatum(ts)] ||= []).push(m);
  }
  const kandidaten = [];
  for (const datum of Object.keys(proTag)) {
    const schonDa = new Set([...vault.lesen("eingang/mail/" + datum + ".md")
      .matchAll(/<!--\s*id:([^\s]+)\s*-->/g)].map((x) => x[1]));
    for (const m of proTag[datum]) if (!schonDa.has(m.id)) { m._tag = datum; kandidaten.push(m); }
  }
  if (!kandidaten.length) return { ok: true, neu: 0 };

  // Nur geschaeftlich Relevantes behalten, dann Volltext holen.
  const behalten = await klassifiziere(kandidaten);
  if (!behalten.length) return { ok: true, neu: 0, geprueft: kandidaten.length };
  for (const m of behalten) m._text = await mailVolltext(m.id);

  // Pro Tag schreiben (aelteste zuerst).
  const nachTag = {};
  for (const m of behalten) (nachTag[m._tag] ||= []).push(m);
  let gesamt = 0, letzteDatei = null;
  for (const datum of Object.keys(nachTag).sort()) {
    const rel = "eingang/mail/" + datum + ".md";
    if (!vault.lesen(rel)) {
      const lang = new Date(datum + "T12:00:00").toLocaleDateString("de-DE",
        { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Berlin" });
      vault.schreibe(rel, `---\ntyp: posteingang\ndatum: ${datum}\n---\n\n# Posteingang · ${lang}\n\n`);
    }
    for (const m of nachTag[datum].reverse()) vault.anhaenge(rel, mailBlock(m));
    gesamt += nachTag[datum].length;
    letzteDatei = rel;
  }
  const neueMails = behalten.map((m) => ({
    von: String(m.from || "").replace(/<[^>]*>/, "").replace(/["']/g, "").trim() || "unbekannt",
    betreff: String(m.subject || "(ohne Betreff)").trim(),
  }));
  return { ok: true, neu: gesamt, geprueft: kandidaten.length, datei: letzteDatei, neueMails };
}

module.exports = { erfassen };
