// Outlook.com / Hotmail als Belegquelle — ueber Microsoft Graph.
//
// Warum (Lukas, 18.09.2026): "könntest du das auch für den Account
// lukas.sehorz@hotmail.com machen für bestimmte Ausgaben?" Hotmail ist kein
// Gmail: weder gws-cli noch die Gmail-Schnittstelle kommen dort hin, und
// IMAP mit Passwort hat Microsoft fuer Outlook.com abgeschaltet. Bleibt die
// Graph-Schnittstelle mit einer einmaligen Freigabe (Geraetecode: das Skript
// nennt einen Code, Lukas tippt ihn im Browser ein, fertig).
//
// Dasselbe Gesicht wie ein Gmail-Konto in lib/gmail-direkt.js — suchen,
// Anhaenge, Anhang holen, markieren — damit lib/mail-belege.js beide gleich
// behandelt. Statt eines Etiketts bekommt eine verarbeitete Mail eine
// Kategorie ("Flowstate/verbucht"); die sieht man in Outlook genauso.
//
// Zugangsdatei: <GWS_HOME>/.config/gws-cli/postfaecher/<name>/outlook.json
//   { client_id, refresh_token, adresse }
// Sie entsteht mit scripts/outlook-anmelden.js. Die client_id stammt aus einer
// App-Registrierung im Microsoft-Entra-Portal ("nur persoenliche Microsoft-
// Konten", oeffentlicher Client erlaubt) — ohne die laesst Microsoft niemanden
// an ein Postfach.
//
// Nur der POSTEINGANG wird gelesen, nie "Gesendet": Was Lukas selbst
// verschickt hat, ist keine Ausgabe (siehe -from:me in mail-belege.js).

const fs = require("fs");

const ANMELDUNG = "https://login.microsoftonline.com/consumers/oauth2/v2.0";
const GRAPH = "https://graph.microsoft.com/v1.0";
const BEREICH = "Mail.ReadWrite offline_access";

function konto(dateiPfad, name = "") {
  let zugang = { token: "", bis: 0 };

  function lesen() {
    let t;
    try { t = JSON.parse(fs.readFileSync(dateiPfad, "utf-8")); }
    catch { throw new Error("Kein Microsoft-Zugang hinterlegt"); }
    if (!t.client_id || !t.refresh_token) throw new Error("Microsoft-Zugang unvollständig (client_id/refresh_token)");
    return t;
  }

  async function token() {
    if (zugang.token && Date.now() < zugang.bis - 60000) return zugang.token;
    const t = lesen();
    const r = await fetch(ANMELDUNG + "/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: t.client_id, grant_type: "refresh_token", refresh_token: t.refresh_token, scope: BEREICH }),
      signal: AbortSignal.timeout(15000),
    });
    const d = await r.json();
    if (!d.access_token) throw new Error("Microsoft verweigert die Erneuerung: " + String(d.error_description || d.error || r.status).slice(0, 120));
    zugang = { token: d.access_token, bis: Date.now() + (d.expires_in || 3600) * 1000 };
    // Microsoft dreht den Erneuerungsschluessel bei jeder Erneuerung weiter —
    // den neuen merken, sonst laeuft der alte nach 90 Tagen aus.
    if (d.refresh_token && d.refresh_token !== t.refresh_token) {
      try { fs.writeFileSync(dateiPfad, JSON.stringify({ ...t, refresh_token: d.refresh_token }, null, 2)); } catch { /* dann eben beim naechsten Mal */ }
    }
    return zugang.token;
  }

  async function api(pfad, opt = {}) {
    const r = await fetch(pfad.startsWith("http") ? pfad : GRAPH + pfad, {
      method: opt.method || "GET",
      headers: { authorization: "Bearer " + (await token()), ...(opt.body ? { "content-type": "application/json" } : {}) },
      body: opt.body ? JSON.stringify(opt.body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw new Error("Graph " + r.status);
    if (opt.roh) return Buffer.from(await r.arrayBuffer());
    return r.status === 204 ? {} : r.json();
  }

  // Suche: Graph kennt keine Gmail-Syntax. Aus {tage, seit, etikett} wird ein
  // $filter auf den Posteingang; Betreff/Absender filtert mail-belege.js wie
  // bei Gmail selbst. Verarbeitete (Kategorie) fallen hier raus.
  async function suchen({ tage = 2, seit = "", etikett = "", max = 25 } = {}) {
    const ab = /^\d{4}-\d{2}-\d{2}$/.test(seit) ? new Date(seit + "T00:00:00Z") : new Date(Date.now() - tage * 86400000);
    const filter = `hasAttachments eq true and receivedDateTime ge ${ab.toISOString().replace(/\.\d{3}Z$/, "Z")}`;
    let url = `/me/mailFolders/inbox/messages?$filter=${encodeURIComponent(filter)}&$select=id,subject,from,categories&$orderby=receivedDateTime desc&$top=${Math.min(100, max)}`;
    const raus = [];
    while (url && raus.length < max) {
      const d = await api(url);
      for (const m of d.value || []) {
        if (etikett && (m.categories || []).includes(etikett)) continue;
        const von = m.from?.emailAddress || {};
        raus.push({ id: m.id, from: von.name ? `${von.name} <${von.address || ""}>` : (von.address || ""), subject: m.subject || "" });
        if (raus.length >= max) break;
      }
      url = d["@odata.nextLink"] || "";
    }
    return raus;
  }

  async function anhaenge(nachrichtId) {
    const d = await api(`/me/messages/${encodeURIComponent(nachrichtId)}/attachments?$select=id,name,contentType,size`);
    return (d.value || []).map((a) => ({ name: a.name || "", typ: a.contentType || "application/octet-stream", id: a.id, groesse: a.size || 0 }));
  }

  // Rohe Bytes ueber /$value — auch fuer grosse Anhaenge, ohne base64-Umweg.
  async function anhangHolen(nachrichtId, anhangId) {
    return api(`/me/messages/${encodeURIComponent(nachrichtId)}/attachments/${encodeURIComponent(anhangId)}/$value`, { roh: true });
  }

  async function etikettSetzen(nachrichtId, name) {
    try {
      const m = await api(`/me/messages/${encodeURIComponent(nachrichtId)}?$select=categories`);
      const alt = m.categories || [];
      if (!alt.includes(name)) await api(`/me/messages/${encodeURIComponent(nachrichtId)}`, { method: "PATCH", body: { categories: [...alt, name] } });
      return true;
    } catch { return false; }
  }

  async function adresse() {
    try { const p = await api("/me?$select=mail,userPrincipalName"); return p.mail || p.userPrincipalName || ""; }
    catch { try { return lesen().adresse || ""; } catch { return ""; } }
  }

  const bereit = () => { try { lesen(); return true; } catch { return false; } };

  return { name, tokenPfad: dateiPfad, art: "outlook", token, api, suchen, anhaenge, anhangHolen, etikettSetzen, adresse, bereit };
}

// --- Einmalige Freigabe per Geraetecode (scripts/outlook-anmelden.js) -------
//
// Schritt 1 liefert Code und Adresse, Schritt 2 wartet, bis Lukas den Code
// eingegeben hat, und gibt den Erneuerungsschluessel zurueck.
async function geraetecodeAnfordern(clientId) {
  const r = await fetch(ANMELDUNG + "/devicecode", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, scope: BEREICH }),
    signal: AbortSignal.timeout(15000),
  });
  const d = await r.json();
  if (!d.device_code) throw new Error("Microsoft gibt keinen Code: " + String(d.error_description || d.error || r.status).slice(0, 200));
  return d; // { device_code, user_code, verification_uri, expires_in, interval, message }
}

async function geraetecodeWarten(clientId, d) {
  const bis = Date.now() + (d.expires_in || 900) * 1000;
  const pause = Math.max(5, d.interval || 5) * 1000;
  while (Date.now() < bis) {
    await new Promise((f) => setTimeout(f, pause));
    const r = await fetch(ANMELDUNG + "/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: d.device_code }),
      signal: AbortSignal.timeout(15000),
    });
    const t = await r.json();
    if (t.refresh_token) return t;
    if (t.error && t.error !== "authorization_pending" && t.error !== "slow_down") {
      throw new Error("Freigabe fehlgeschlagen: " + String(t.error_description || t.error).slice(0, 200));
    }
  }
  throw new Error("Der Code ist abgelaufen, ohne dass er eingegeben wurde.");
}

module.exports = { konto, geraetecodeAnfordern, geraetecodeWarten, BEREICH };
