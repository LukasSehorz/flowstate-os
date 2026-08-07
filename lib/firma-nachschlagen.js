// Was das CRM ueber eine Firma weiss — fuer Angebote und Rechnungen.
//
// Warum (Lukas, 07.08.2026): "Man soll entweder Adresse checken oder wenn die
// Webseite hinterlegt ist, dann auf diese gehen und das darüber erstellen."
//
// Der Anlass: Nach einem Erstgespraech sitzt Lukas im Auto und will ein Angebot.
// Anschrift, Ansprechpartner und Mailadresse stehen aber nicht in seinem Kopf,
// sondern im CRM — und sie dort abzulesen heisst anhalten. Nachgezaehlt am
// 07.08.: von 1.290 Firmen haben 1.253 eine Adresse, 1.213 eine Website, 912
// eine Mailadresse. Es ist also fast immer da.
//
// WAS LUKAS SAGT, GEWINNT. Das CRM fuellt nur, was er NICHT gesagt hat. Er
// sitzt beim Kunden, das CRM ist womoeglich ein halbes Jahr alt — und eine
// Anschrift aus dem CRM, die eine frisch genannte ueberschreibt, waere ein
// Fehler, den niemand bemerkt, bis der Brief zurueckkommt.
//
// BEI MEHREREN TREFFERN WIRD GEFRAGT, nicht geraten. "Bergmann" kann drei
// Firmen meinen. Ein Angebot an den falschen Kunden ist schlimmer als eine
// Rueckfrage.

const crm = require("./crm.js");

// Nur die Felder, die auf einem Beleg landen oder den Text tragen.
const FELDER = "id, name, branche, website, telefon, email, adresse, plz, ort, " +
  "geschaeftsfuehrer, geschlecht, taetigkeit, mitarbeiter_zahl, leistungen, " +
  "besonderes, anruf_notiz, notizen, preis_setup, preis_monatlich";

async function frag(sql, args) {
  try { const r = await crm.system(sql, args); return r.rows; }
  catch (e) { console.error("Firma nachschlagen:", e.message); return null; }
}

// Aus "Herr" / "Frau" und dem Namen die Briefanrede bauen.
// geschlecht steht im CRM als "m"/"w" oder ausgeschrieben.
function anredeZeile(name, geschlecht) {
  const n = String(name || "").trim();
  if (!n) return "";
  const g = String(geschlecht || "").toLowerCase();
  if (/^w|^f|frau/.test(g)) return `Frau ${n}`;
  if (/^m|herr/.test(g)) return `Herrn ${n}`;
  return n;   // unbekannt: lieber ohne Anrede als mit der falschen
}

// suche: der Firmenname, wie Lukas ihn gesagt hat.
async function suchen(suche) {
  const name = String(suche || "").trim();
  if (name.length < 3) return { ok: false, grund: "zu-kurz" };

  const treffer = await frag(
    `select ${FELDER} from firmen where name ilike $1 ` +
    "order by (lower(name) = lower($2)) desc, (name ilike $3) desc, letzte_aktivitaet desc nulls last limit 4",
    ["%" + name + "%", name, name + "%"]);

  if (!treffer) return { ok: false, grund: "nicht-erreichbar" };
  if (!treffer.length) return { ok: false, grund: "nicht-gefunden" };

  // Eindeutig ist NUR: genau ein Treffer, oder der erste heisst woertlich so.
  //
  // Der erste Entwurf liess auch "faengt damit an" als eindeutig durchgehen.
  // Damit haette "Bergmann" bei drei Bergmann-Firmen die "Bergmann
  // Elektrotechnik" gewaehlt — nur weil ihr Name vorn anfaengt, waehrend
  // "Physiotherapie Bergmann" gemeint war. Ein Angebot an den falschen Kunden,
  // mit dessen Anschrift und Mailadresse.
  //
  // Eine Rueckfrage kostet Lukas fuenf Sekunden. Das andere kostet einen Kunden.
  const eins = treffer[0];
  const woertlich = eins.name.toLowerCase() === name.toLowerCase();
  if (treffer.length > 1 && !woertlich) {
    return { ok: false, grund: "mehrdeutig", namen: treffer.map((f) => f.name) };
  }
  return { ok: true, firma: eins };
}

// Ergaenzt einen Auftrag um das, was im CRM steht — ohne zu ueberschreiben.
// Gibt zurueck, WAS ergaenzt wurde, damit Alexandra es sagen kann.
async function ergaenzen(auftrag) {
  const r = await suchen(auftrag.firma);
  if (!r.ok) return { auftrag, quelle: null, grund: r.grund, namen: r.namen };

  const f = r.firma;
  const dazu = [];
  const neu = { ...auftrag };

  // Der Firmenname aus dem CRM ist der gepflegte — "Bergmann" wird zu
  // "Physiotherapie Bergmann". Auf einem Beleg gehoert der volle Name hin.
  if (f.name && f.name.length > String(auftrag.firma || "").length) {
    neu.firma = f.name;
    dazu.push("Firmenname");
  }
  if (!neu.anrede && f.geschaeftsfuehrer) {
    const a = anredeZeile(f.geschaeftsfuehrer, f.geschlecht);
    if (a) { neu.anrede = a; dazu.push("Ansprechpartner"); }
  }
  if (!neu.strasse && f.adresse) { neu.strasse = f.adresse; dazu.push("Anschrift"); }
  if (!neu.plz_ort && (f.plz || f.ort)) {
    neu.plz_ort = [f.plz, f.ort].filter(Boolean).join(" ").trim();
    if (!dazu.includes("Anschrift")) dazu.push("Anschrift");
  }
  if (!neu.email && f.email) { neu.email = f.email; dazu.push("Mailadresse"); }

  return {
    auftrag: neu,
    quelle: {
      id: f.id, name: f.name, website: f.website || "", branche: f.branche || "",
      taetigkeit: f.taetigkeit || "", leistungen: f.leistungen || "",
      besonderes: f.besonderes || "", anruf_notiz: f.anruf_notiz || "",
      mitarbeiter_zahl: f.mitarbeiter_zahl || null, ort: f.ort || "",
    },
    dazu,
  };
}

// Was aus dem CRM in den Angebotstext einfliesst — kurz gehalten, damit es die
// Beschreibung von Lukas ergaenzt und nicht uebertoent.
function alsText(q) {
  if (!q) return "";
  return [
    q.branche ? `Branche: ${q.branche}` : null,
    q.taetigkeit ? `Tätigkeit: ${q.taetigkeit}` : null,
    q.leistungen ? `Leistungen: ${String(q.leistungen).slice(0, 400)}` : null,
    q.mitarbeiter_zahl ? `Mitarbeiter: ${q.mitarbeiter_zahl}` : null,
    q.ort ? `Ort: ${q.ort}` : null,
    q.besonderes ? `Besonderes: ${String(q.besonderes).slice(0, 400)}` : null,
    q.anruf_notiz ? `Notiz aus dem Telefonat: ${String(q.anruf_notiz).slice(0, 600)}` : null,
  ].filter(Boolean).join("\n");
}

module.exports = { suchen, ergaenzen, alsText, anredeZeile };
