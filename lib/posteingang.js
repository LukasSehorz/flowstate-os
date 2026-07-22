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

const berlinHeute = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());

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

async function erfassen({ max = 25 } = {}) {
  if (!vault.schreibbar("eingang")) return { ok: false, grund: "eingang nicht beschreibbar (Mount :ro?)." };

  let liste;
  try { liste = envelopeDaten(await gws(["gmail", "search", "in:inbox newer_than:2d", "--max", String(max)])); }
  catch (e) { return { ok: false, grund: String(e.message).slice(0, 150) }; }

  const datum = berlinHeute();
  const rel = "eingang/mail/" + datum + ".md";
  const bestehend = vault.lesen(rel);
  const schonDa = new Set([...bestehend.matchAll(/<!--\s*id:([^\s]+)\s*-->/g)].map((m) => m[1]));

  // Nur Mails von HEUTE, die noch nicht erfasst und kein Rauschen sind.
  const neu = liste.filter((m) =>
    m.id && !schonDa.has(m.id) && !istRauschen(m) &&
    String(m.date && zeitKurz(m.date)).includes("."));  // hat ein Datum
  const heuteNeu = neu.filter((m) => {
    const ts = Date.parse(m.date);
    return !Number.isNaN(ts) &&
      new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date(ts)) === datum;
  });
  if (!heuteNeu.length) return { ok: true, neu: 0 };

  if (!bestehend) {
    const lang = new Date().toLocaleDateString("de-DE",
      { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Berlin" });
    vault.schreibe(rel, `---\ntyp: posteingang\ndatum: ${datum}\n---\n\n# Posteingang · ${lang}\n\n`);
  }

  // Aelteste zuerst anhaengen (gws liefert neueste zuerst).
  for (const m of heuteNeu.reverse()) {
    const von = String(m.from || "unbekannt").replace(/["']/g, "").trim();
    const betreff = String(m.subject || "(ohne Betreff)").trim();
    const snippet = String(m.snippet || "").replace(/\s+/g, " ").trim().slice(0, 300);
    const block =
      `## ${betreff}\n` +
      `- **Von:** ${von}\n` +
      `- **Zeit:** ${zeitKurz(m.date)}\n` +
      (snippet ? `\n${snippet}\n` : "") +
      `\n<!-- id:${m.id} -->\n\n`;
    vault.anhaenge(rel, block);
  }
  return { ok: true, neu: heuteNeu.length, datei: rel };
}

module.exports = { erfassen };
