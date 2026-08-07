// Die Website eines Kunden lesen, um ein Angebot darauf zu schreiben.
//
// Warum (Lukas, 07.08.2026): "Wenn die Webseite hinterlegt ist, dann auf diese
// gehen und das darüber erstellen."
//
// Das ist die beste Quelle, die es gibt: Was ein Betrieb anbietet, wo er sitzt
// und wie er sich nennt, steht auf seiner Startseite genauer als in jedem
// CRM-Feld. Und im CRM ist sie fast immer hinterlegt — 1.213 von 1.290 Firmen.
//
// SCHRANKEN, und jede hat einen Grund:
//
//   · Nur http/https. Eine URL aus der Datenbank ist kein vertrauenswuerdiger
//     Eingabewert — file:// oder gopher:// haetten hier nichts zu suchen.
//   · Keine Adressen im eigenen Netz. Der Server steht neben der Datenbank und
//     dem Hermes-Container. Ein Eintrag wie "http://localhost:5432" wuerde sonst
//     den Server dazu bringen, sich selbst abzufragen und das Ergebnis in ein
//     Angebot zu schreiben.
//   · Umleitungen werden verfolgt, aber jede erneut geprueft — sonst umgeht
//     eine Umleitung die Netzpruefung.
//   · Acht Sekunden, dann ist Schluss. Lukas wartet auf sein Angebot; eine
//     langsame Kundenseite darf das nicht aufhalten.
//   · Hoechstens 600 kB und nur HTML. Ein hinterlegtes PDF oder Video wuerde
//     nichts beitragen und alles blockieren.

const dns = require("dns").promises;

const ZEIT_MS = 8000;
const MAX_BYTES = 600 * 1024;
const MAX_ZEICHEN = 6000;

// Private und besondere Bereiche nach RFC 1918 und Nachbarn.
function istIntern(ip) {
  if (/^127\.|^10\.|^169\.254\.|^0\./.test(ip)) return true;
  if (/^192\.168\./.test(ip)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (ip === "::1" || /^f[cd]/i.test(ip) || /^fe80:/i.test(ip)) return true;
  return false;
}

async function erlaubt(urlText) {
  let u;
  try { u = new URL(urlText); } catch { return { ok: false, grund: "keine gültige Adresse" }; }
  if (!/^https?:$/.test(u.protocol)) return { ok: false, grund: "kein http(s)" };
  try {
    const treffer = await dns.lookup(u.hostname, { all: true });
    if (!treffer.length) return { ok: false, grund: "Adresse nicht auflösbar" };
    if (treffer.some((t) => istIntern(t.address))) return { ok: false, grund: "interne Adresse" };
  } catch { return { ok: false, grund: "Adresse nicht auflösbar" }; }
  return { ok: true, url: u.toString() };
}

// Aus HTML lesbaren Text machen. Bewusst schlicht: Es geht nicht um eine
// getreue Wiedergabe, sondern darum, WORUM ES GEHT.
function textAus(html) {
  let t = String(html);
  // Titel und Beschreibung zuerst — sie sagen oft am meisten.
  const titel = (t.match(/<title[^>]*>([^<]{3,200})<\/title>/i) || [])[1] || "";
  const besch = (t.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{10,400})["']/i) || [])[1] || "";

  t = t.replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|section)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCharCode(parseInt(n, 16)))
    // Deutsche Umlaute stehen auf aelteren Seiten als benannte Entities. Ohne
    // diese Zeile wurde aus "R&auml;umen" ein "R umen" — die Auffangregel
    // darunter ersetzt alles Unbekannte durch ein Leerzeichen. Der Text geht
    // zwar nur ans Modell und nicht direkt ins Angebot, aber zerhackte Woerter
    // sind eine schlechtere Grundlage als saubere.
    .replace(/&(auml|Auml|ouml|Ouml|uuml|Uuml|szlig|amp|quot|apos|nbsp|shy|ndash|mdash|hellip|euro|laquo|raquo|bdquo|ldquo|rdquo);/g,
      (m, n) => ({ auml: "ä", Auml: "Ä", ouml: "ö", Ouml: "Ö", uuml: "ü", Uuml: "Ü", szlig: "ß",
        amp: "&", quot: '"', apos: "'", nbsp: " ", shy: "", ndash: "–", mdash: "—",
        hellip: "…", euro: "€", laquo: "«", raquo: "»", bdquo: "„", ldquo: "“", rdquo: "”" }[n]))
    .replace(/&[a-z][a-z0-9]*;/gi, " ")
    .replace(/[ \t]+/g, " ")
    .split("\n").map((z) => z.trim()).filter((z) => z.length > 2)
    .join("\n").replace(/\n{3,}/g, "\n\n");

  const kopf = [titel && `Titel: ${titel}`, besch && `Beschreibung: ${besch}`].filter(Boolean).join("\n");
  return (kopf ? kopf + "\n\n" : "") + t.slice(0, MAX_ZEICHEN);
}

// Gibt { ok, text, url } oder { ok:false, grund }. Wirft nie.
async function lesen(urlText) {
  const roh = String(urlText || "").trim();
  if (!roh) return { ok: false, grund: "keine Website hinterlegt" };
  const mitSchema = /^https?:\/\//i.test(roh) ? roh : "https://" + roh;

  let ziel = mitSchema;
  try {
    // Bis zu drei Umleitungen, jede neu geprueft.
    for (let sprung = 0; sprung < 4; sprung++) {
      const pruefung = await erlaubt(ziel);
      if (!pruefung.ok) return { ok: false, grund: pruefung.grund };

      const r = await fetch(pruefung.url, {
        redirect: "manual",
        headers: { "user-agent": "Flowstate-Angebot/1.0", accept: "text/html" },
        signal: AbortSignal.timeout(ZEIT_MS),
      });

      if (r.status >= 300 && r.status < 400) {
        const weiter = r.headers.get("location");
        if (!weiter) return { ok: false, grund: "Umleitung ohne Ziel" };
        ziel = new URL(weiter, pruefung.url).toString();
        continue;
      }
      if (!r.ok) return { ok: false, grund: `Seite antwortet mit ${r.status}` };

      const typ = r.headers.get("content-type") || "";
      if (!/text\/html|application\/xhtml/i.test(typ)) return { ok: false, grund: `kein HTML (${typ.split(";")[0]})` };

      const puffer = Buffer.from(await r.arrayBuffer());
      if (puffer.length > MAX_BYTES) return { ok: false, grund: "Seite zu groß" };

      const text = textAus(puffer.toString("utf-8"));
      if (text.length < 120) return { ok: false, grund: "kaum Text auf der Seite" };
      return { ok: true, text, url: pruefung.url };
    }
    return { ok: false, grund: "zu viele Umleitungen" };
  } catch (e) {
    const m = String(e.message || "");
    return { ok: false, grund: /timeout|abort/i.test(m) ? "Seite antwortet nicht" : m.slice(0, 80) };
  }
}

module.exports = { lesen, textAus, erlaubt, istIntern };
