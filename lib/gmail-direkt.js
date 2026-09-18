// Direkter Gmail-Zugang — nur fuer das, was gws-cli nicht kann: Anhaenge.
//
// Warum es das gibt (07.08.2026): Lukas will, dass Rechnungen, die per Mail
// kommen, automatisch im Belegeingang landen. Dafuer braucht es die PDF-Datei.
//
// gws-cli kann Mails suchen und lesen, liefert aber NUR Betreff und Fliesstext
// zurueck — nachgemessen an einer echten Rechnungsmail: kein Anhangsfeld, keine
// Teile, keine Daten. Es gibt auch keinen Befehl dafuer.
//
// Der Zugang liegt aber schon da: /gws-home/.config/gws-cli/token.json traegt
// ein refresh_token und den Bereich gmail.modify — das schliesst das Lesen von
// Anhaengen ein. Hier wird derselbe Zugang benutzt, nur der eine Aufruf, den
// gws-cli nicht anbietet.
//
// BEWUSST KLEIN GEHALTEN: Suchen und Lesen laufen weiter ueber gws-cli (dort
// stecken die Sicherheitshuellen und die Trennung von externem Inhalt). Dieses
// Modul macht nur zwei Dinge — Anhangsliste und Anhang holen.

const fs = require("fs");
const path = require("path");

const GWS_VERZEICHNIS = path.join(process.env.GWS_HOME || "/gws-home", ".config", "gws-cli");
const TOKEN = process.env.GWS_TOKEN_DATEI || path.join(GWS_VERZEICHNIS, "token.json");

// ZWEITE POSTFAECHER (18.09.2026).
//
// Lukas: "alle Rechnungen, die wir in der SvH-Consult-Mail von Lukas UND
// Jannik bekommen haben". Der gws-cli-Zugang oben ist EIN Konto (Lukas).
// Janniks Rechnungen liegen in seinem eigenen Postfach, und Gmail laesst ein
// fremdes Postfach ueber die Schnittstelle nur mit dessen eigenem Zugang
// lesen — Kalender kann man freigeben, Mail nicht.
//
// Darum: je weiteres Postfach eine Token-Datei unter
//   <GWS_HOME>/.config/gws-cli/postfaecher/<name>/token.json
// im selben Format wie gws-cli sie schreibt (einmal "gws-cli auth" auf einem
// Rechner mit Browser, mit derselben client_secret.json, dann die token.json
// dorthin kopieren). Der Ordner wird bei jedem Lauf gelesen — eine neue Datei
// wirkt sofort, ohne Neustart und ohne Umgebungsvariable.
//
// BEWUSST NICHT ueber "gws-cli account add": Sobald gws-cli ein benanntes
// Konto kennt, schaltet es in den Mehrkonten-Modus und ignoriert die
// bisherige token.json — Kalender, Kanzlei-Versand und alles andere wuerde
// ins Leere laufen. Ein eigener Ordner laesst gws-cli in Ruhe.
const POSTFAECHER = path.join(GWS_VERZEICHNIS, "postfaecher");

// Ein Zugang je Token-Datei. Alles, was unten fuer das Hauptkonto steht, ist
// ein konto(TOKEN) — dieselben Funktionen, nur mit eigenem Erneuerungs-Merker.
function konto(tokenPfad, name = "") {
  // Ein erneuerter Zugang gilt eine Stunde. Innerhalb eines Laufs wird er
  // wiederverwendet, statt fuer jede Mail neu geholt zu werden.
  let zugang = { token: "", bis: 0 };

  async function token() {
    if (zugang.token && Date.now() < zugang.bis - 60000) return zugang.token;
    let t;
    try { t = JSON.parse(fs.readFileSync(tokenPfad, "utf-8")); }
    catch { throw new Error("Kein Google-Zugang hinterlegt"); }
    if (!t.refresh_token) throw new Error("Google-Zugang ohne Erneuerungsschluessel");

    const r = await fetch(t.token_uri || "https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: t.client_id, client_secret: t.client_secret,
        refresh_token: t.refresh_token, grant_type: "refresh_token",
      }),
      signal: AbortSignal.timeout(15000),
    });
    const d = await r.json();
    if (!d.access_token) throw new Error("Google verweigert die Erneuerung");
    zugang = { token: d.access_token, bis: Date.now() + (d.expires_in || 3600) * 1000 };
    return zugang.token;
  }

  async function api(pfad, opt = {}) {
    const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/" + pfad, {
      method: opt.method || "GET",
      headers: { authorization: "Bearer " + (await token()), ...(opt.body ? { "content-type": "application/json" } : {}) },
      body: opt.body ? JSON.stringify(opt.body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw new Error("Gmail " + r.status);
    return r.json();
  }

  // Alle Anhaenge einer Nachricht — flach, mit Namen, Typ und Groesse.
  //
  // Die Teile sind verschachtelt (multipart/mixed -> multipart/alternative -> ...),
  // deshalb rekursiv. Teile ohne Dateinamen sind der Textkoerper, keine Anhaenge.
  async function anhaenge(nachrichtId) {
    const m = await api(`messages/${nachrichtId}?format=full`);
    const raus = [];
    (function geh(p) {
      if (!p) return;
      if (p.filename && p.body?.attachmentId) {
        raus.push({
          name: p.filename,
          typ: p.mimeType || "application/octet-stream",
          id: p.body.attachmentId,
          groesse: p.body.size || 0,
        });
      }
      (p.parts || []).forEach(geh);
    })(m.payload);
    return raus;
  }

  // Einen Anhang als Buffer. Gmail liefert base64url — das ist NICHT dasselbe wie
  // base64: "-" statt "+", "_" statt "/". Wer das verwechselt, bekommt eine Datei,
  // die fast richtig ist und beim Oeffnen scheitert.
  async function anhangHolen(nachrichtId, anhangId) {
    const d = await api(`messages/${nachrichtId}/attachments/${anhangId}`);
    if (!d.data) throw new Error("Anhang ohne Inhalt");
    return Buffer.from(d.data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  }

  // Suche wie "gws-cli gmail search", nur direkt: erst die Kennungen, dann je
  // Nachricht Absender und Betreff aus den Kopfzeilen. Mehr wird nicht
  // geholt — der Textkoerper ist fuer den Belegeingang ohne Belang, und was
  // von aussen kommt, wird ohnehin nur als Daten gelesen (Filter), nie als
  // Anweisung.
  async function suchen(frage, max = 25) {
    const ids = [];
    let seite = "";
    while (ids.length < max) {
      const d = await api(`messages?q=${encodeURIComponent(frage)}&maxResults=${Math.min(100, max - ids.length)}${seite ? "&pageToken=" + encodeURIComponent(seite) : ""}`);
      for (const m of d.messages || []) ids.push(m.id);
      seite = d.nextPageToken || "";
      if (!seite || !(d.messages || []).length) break;
    }
    const raus = [];
    for (const id of ids) {
      let m;
      try { m = await api(`messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`); }
      catch { continue; }
      const kopf = (n) => (m.payload?.headers || []).find((h) => String(h.name).toLowerCase() === n)?.value || "";
      raus.push({ id, from: kopf("from"), subject: kopf("subject") });
    }
    return raus;
  }

  // Etikett setzen (mit Anlegen beim ersten Mal) — das Gegenstueck zu
  // "gws-cli gmail add-labels".
  let etiketten = null;
  async function etikettId(name) {
    if (!etiketten) etiketten = (await api("labels")).labels || [];
    let l = etiketten.find((x) => x.name === name);
    if (!l) {
      l = await api("labels", { method: "POST", body: { name, labelListVisibility: "labelShow", messageListVisibility: "show" } });
      etiketten.push(l);
    }
    return l.id;
  }
  async function etikettSetzen(nachrichtId, name) {
    try {
      const id = await etikettId(name);
      await api(`messages/${nachrichtId}/modify`, { method: "POST", body: { addLabelIds: [id] } });
      return true;
    } catch { return false; }
  }

  // Wessen Postfach das ist — zum Nachsehen ("welches Konto haengt dran?").
  async function adresse() {
    try { return (await api("profile")).emailAddress || ""; } catch { return ""; }
  }

  const bereit = () => { try { return Boolean(JSON.parse(fs.readFileSync(tokenPfad, "utf-8")).refresh_token); } catch { return false; } };

  return { name, tokenPfad, token, api, anhaenge, anhangHolen, suchen, etikettSetzen, adresse, bereit };
}

// Die weiteren Postfaecher aus dem Ordner — nur die mit brauchbarer
// Token-Datei. Ohne Ordner: leere Liste, nichts bricht.
function postfaecher() {
  let namen = [];
  try { namen = fs.readdirSync(POSTFAECHER).filter((n) => /^[a-z0-9_.-]+$/i.test(n)).sort(); }
  catch { return []; }
  return namen
    .map((n) => konto(path.join(POSTFAECHER, n, "token.json"), n))
    .filter((k) => k.bereit());
}

// Das Hauptkonto: derselbe Zugang wie gws-cli.
const haupt = konto(TOKEN, "");
const { token, anhaenge, anhangHolen, bereit } = haupt;

// --- Senden MIT Anhang ------------------------------------------------------
//
// Auch das kann gws-cli nicht: "gws-cli gmail send" nimmt Empfaenger, Betreff
// und Text — kein Anhang, keine Option dafuer. Fuer den Rechnungsversand ist der
// Anhang aber der ganze Zweck.
//
// Der Zugangsbereich gmail.modify deckt das Senden mit ab (nachgemessen, nicht
// angenommen: siehe scripts/test-mail-anhang.js, das einen Entwurf mit Anhang
// anlegt und wieder loescht).

function post(pfad, koerper) {
  return token().then((t) => fetch("https://gmail.googleapis.com/gmail/v1/users/me/" + pfad, {
    method: "POST",
    headers: { authorization: "Bearer " + t, "content-type": "application/json" },
    body: JSON.stringify(koerper),
    signal: AbortSignal.timeout(60000),
  })).then(async (r) => {
    if (!r.ok) throw new Error("Gmail " + r.status + " " + (await r.text()).slice(0, 200));
    return r.json();
  });
}

// Kopfzeilen duerfen nur ASCII enthalten. Umlaute im Betreff ("Rechnung fuer
// Müller & Sohn") muessen kodiert werden, sonst kommt beim Empfaenger Buchstabensalat an.
function kopfWert(s) {
  const t = String(s || "").replace(/[\r\n]/g, " ");
  return /^[\x20-\x7E]*$/.test(t) ? t : "=?UTF-8?B?" + Buffer.from(t, "utf-8").toString("base64") + "?=";
}

// Ein Dateiname mit Umlaut braucht dieselbe Behandlung, aber nach anderer Regel
// (RFC 2231) — sonst zeigt der Empfaenger "Rechnung f=?r Mueller.pdf".
function dateiname(n) {
  const t = String(n || "anhang").replace(/["\r\n]/g, "");
  return /^[\x20-\x7E]*$/.test(t)
    ? `filename="${t}"`
    : `filename*=UTF-8''${encodeURIComponent(t)}`;
}

function mimeBauen({ an, betreff, text, absender, anhaenge: dateien = [] }) {
  const grenze = "flowstate-" + Buffer.from(String(betreff || "x")).toString("hex").slice(0, 16) + "-teil";
  const teile = [
    `To: ${kopfWert(an)}`,
    absender ? `From: ${kopfWert(absender)}` : null,
    `Subject: ${kopfWert(betreff)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${grenze}"`,
    "",
    `--${grenze}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(String(text || ""), "utf-8").toString("base64").replace(/(.{76})/g, "$1\r\n"),
  ].filter((x) => x !== null);

  for (const a of dateien) {
    teile.push(
      `--${grenze}`,
      `Content-Type: ${a.typ || "application/octet-stream"}; name="${String(a.name).replace(/["\r\n]/g, "")}"`,
      `Content-Disposition: attachment; ${dateiname(a.name)}`,
      "Content-Transfer-Encoding: base64",
      "",
      a.daten.toString("base64").replace(/(.{76})/g, "$1\r\n"));
  }
  teile.push(`--${grenze}--`, "");
  return Buffer.from(teile.join("\r\n"), "utf-8").toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Wirklich senden.
async function senden({ an, betreff, text, absender, anhaenge: dateien = [] }) {
  // DER RIEGEL FUER PROBELAEUFE (20.08.2026).
  //
  // Hier fehlte er, und das war gefaehrlich: scripts/ads-proben.js spielt
  // Szenarien mit Freigabe durch, unter anderem "Angebot erstellen und
  // rausschicken". Der Probemodus fing bisher Telegram, WhatsApp und Anrufe
  // ab — Google-Mail nicht. Ein Probelauf, der bei beleg_erstellen ein "ja"
  // durchspielt, haette eine ECHTE Rechnung an einen ECHTEN Kunden
  // geschickt. Aufgefallen beim Bau des Steuer-Versands, der sich seinen
  // eigenen Riegel gebaut hatte, weil dieser hier fehlte.
  //
  // Der Riegel sitzt an der LETZTEN Stelle, direkt vor dem Aufruf an Google:
  // Alles davor — Adresse aufloesen, Text bauen, Anhaenge packen — laeuft
  // echt, damit die Probe misst, was sie messen soll.
  const probemodus = require("./probemodus.js");
  if (probemodus.aktiv()) {
    probemodus.notieren("mail", {
      an: String(an || "").slice(0, 120),
      betreff: String(betreff || "").slice(0, 200),
      anhaenge: (dateien || []).length,
    });
    return { ok: true, id: "probe", abgefangen: true };
  }
  const d = await post("messages/send", { raw: mimeBauen({ an, betreff, text, absender, anhaenge: dateien }) });
  return { ok: true, id: d.id };
}

// Nur als Entwurf ablegen — fuer den Fall, dass Lukas selbst nochmal
// drueberschauen will, und fuer den Selbsttest des Zugangs.
async function entwurf({ an, betreff, text, absender, anhaenge: dateien = [] }) {
  // Derselbe Riegel wie in senden() (20.08.2026). Ein Entwurf verlaesst das
  // Haus zwar nicht — aber ein Probelauf ueber 80 Szenarien wuerde Lukas'
  // Postfach mit Entwuerfen zumuellen, die er einzeln wegraeumen muss. Und
  // ein Entwurf mit ZIP-Anhang belegt echten Speicherplatz.
  const probemodus = require("./probemodus.js");
  if (probemodus.aktiv()) {
    probemodus.notieren("mail-entwurf", {
      an: String(an || "").slice(0, 120),
      betreff: String(betreff || "").slice(0, 200),
      anhaenge: (dateien || []).length,
    });
    return { ok: true, id: "probe", nachrichtId: "probe", abgefangen: true };
  }
  const d = await post("drafts", { message: { raw: mimeBauen({ an, betreff, text, absender, anhaenge: dateien }) } });
  return { ok: true, id: d.id, nachrichtId: d.message?.id };
}

async function entwurfLoeschen(id) {
  const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts/" + id, {
    method: "DELETE",
    headers: { authorization: "Bearer " + (await token()) },
    signal: AbortSignal.timeout(20000),
  });
  return r.ok;
}

module.exports = { anhaenge, anhangHolen, bereit, senden, entwurf, entwurfLoeschen, mimeBauen, konto, postfaecher, haupt, POSTFAECHER };
