// lib/posteingang.js — Mail-Zufluss ins zweite Gehirn.
//
// Liest regelmaessig den Posteingang und schreibt NEUE Mails (Absender, Betreff,
// Zeit, Kurztext) in eine Tagesnotiz eingang/mail/YYYY-MM-DD.md. Ueber die Zeit
// entsteht ein durchsuchbares Mail-Gedaechtnis in Obsidian, auf das Alexandra
// jederzeit zugreift (auch mobil, weil es ueber Git synct).
//
// Entscheidung Lukas 22.07.: Mailinhalte duerfen ins private Repo. Dedupliziert
// ueber die Message-ID (als HTML-Kommentar in jeder Notiz), damit nichts doppelt
// landet. Kein Token-Verbrauch — nur ein gws-cli-Aufruf + Dateischreiben.

const { execFile } = require("child_process");
const vault = require("./vault.js");

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

function mailBlock(m) {
  const von = String(m.from || "unbekannt").replace(/["']/g, "").trim();
  const betreff = String(m.subject || "(ohne Betreff)").trim();
  const snippet = String(m.snippet || "").replace(/\s+/g, " ").trim().slice(0, 300);
  return `## ${betreff}\n- **Von:** ${von}\n- **Zeit:** ${zeitKurz(m.date)}\n` +
    (snippet ? `\n${snippet}\n` : "") + `\n<!-- id:${m.id} -->\n\n`;
}

async function erfassen({ max = 30, tage = 3 } = {}) {
  if (!vault.schreibbar("eingang")) return { ok: false, grund: "eingang nicht beschreibbar (Mount :ro?)." };

  let liste;
  try { liste = envelopeDaten(await gws(["gmail", "search", "in:inbox newer_than:" + tage + "d", "--max", String(max)])); }
  catch (e) { return { ok: false, grund: String(e.message).slice(0, 150) }; }

  // Nach Ankunftstag gruppieren: jede Mail kommt in die Notiz IHRES Tages.
  const proTag = {};
  for (const m of liste) {
    if (!m.id || istRauschen(m)) continue;
    const ts = Date.parse(m.date);
    if (Number.isNaN(ts)) continue;
    (proTag[berlinDatum(ts)] ||= []).push(m);
  }

  let gesamt = 0, letzteDatei = null;
  for (const datum of Object.keys(proTag).sort()) {
    const rel = "eingang/mail/" + datum + ".md";
    const bestehend = vault.lesen(rel);
    const schonDa = new Set([...bestehend.matchAll(/<!--\s*id:([^\s]+)\s*-->/g)].map((x) => x[1]));
    const neu = proTag[datum].filter((m) => !schonDa.has(m.id));
    if (!neu.length) continue;

    if (!bestehend) {
      const lang = new Date(datum + "T12:00:00").toLocaleDateString("de-DE",
        { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Berlin" });
      vault.schreibe(rel, `---\ntyp: posteingang\ndatum: ${datum}\n---\n\n# Posteingang · ${lang}\n\n`);
    }
    for (const m of neu.reverse()) vault.anhaenge(rel, mailBlock(m)); // aelteste zuerst
    gesamt += neu.length;
    letzteDatei = rel;
  }
  return { ok: true, neu: gesamt, datei: letzteDatei };
}

module.exports = { erfassen };
