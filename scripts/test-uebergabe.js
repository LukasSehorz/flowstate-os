// Testet, dass ein Mitarbeiter seinen Lead an eine Kollegin uebergeben kann
// — und dass eine Webseite nie als kaputter Link in der Liste landet.
//
// Anlass (06.08.2026, echter Ausfall): Simon bucht ein Erstgespraech, stellt
// in der Akte "Verantwortlich" auf Jannik und drueckt Speichern. Antwort:
// {"ok":false,"fehler":"Da ist auf dem Server etwas schiefgegangen."} — im Log
// "new row violates row-level security policy for table deals". Dreimal
// versucht, jedes Mal war das Eingetippte weg.
//
// Braucht die Datenbank, laeuft darum NICHT in scripts/pruefen.js mit:
//   docker exec -w /app flowstate-dashboard node scripts/test-uebergabe.js
const fs = require("fs"), path = require("path");
const envPfad = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPfad)) {
  for (const z of fs.readFileSync(envPfad, "utf-8").split("\n")) {
    const t = z.trim(); if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("="); if (i > 0) process.env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim();
  }
}
const crm = require("../lib/crm.js");

let fehler = 0;
const melde = (ok, text) => { console.log((ok ? "✅" : "❌") + " " + text); if (!ok) fehler++; };

const routen = {};
const app = {
  get: (p, ...h) => { routen["GET " + p] = h[h.length - 1]; },
  post: (p, ...h) => { routen["POST " + p] = h[h.length - 1]; },
  use: () => {},
};
require("../lib/crm-routes.js")(app);

function rufen(schluessel, req) {
  return new Promise((fertig, schief) => {
    const res = {
      send: (html) => fertig({ html }),
      json: (d) => fertig({ json: d }),
      redirect: (ziel) => fertig({ redirect: ziel }),
      status(c) { this.code = c; return this; },
    };
    Promise.resolve(routen[schluessel](req, res, schief)).catch(schief);
  });
}

(async () => {
  const { rows: leute } = await crm.system(
    `select id, name, rolle, coalesce(module, '{}') as module from profiles where aktiv order by rolle, name`);
  const chef = leute.find((p) => p.rolle === "admin");
  const a = leute.find((p) => p.rolle !== "admin");
  const b = leute.find((p) => p.rolle !== "admin" && p.id !== a.id) || chef;
  if (!chef || !a) { console.error("Kein Admin oder kein Mitarbeiter in profiles."); process.exit(1); }
  console.log(`Getestet: ${a.name} uebergibt an ${b.name}\n`);

  // ------------------------------------------------- Lead mit Deal anlegen
  const name = "ZZ Testfirma Uebergabe " + process.pid;
  await crm.leadsAnlegen(a, [{ name, telefon: "+49 89 4444" + String(process.pid).slice(-4) }],
    { sparte: "webdesign", besitzer: a.id });
  const { rows: [firma] } = await crm.system(`select id from firmen where name = $1`, [name]);
  await crm.leadakteAnlegen(a, firma.id, "webdesign");
  const { rows: [deal] } = await crm.system(
    `select id, besitzer from deals where firma_id = $1`, [firma.id]);
  melde(deal && String(deal.besitzer) === String(a.id), `Deal gehoert zunaechst ${a.name}`);

  // -------------------------------------------------------- Die Uebergabe
  // Genau der Aufruf, der am 06.08. gescheitert ist: die ganze Akte auf
  // einmal, mit einem anderen Verantwortlichen als dem, der speichert.
  let absturz = null;
  const antwort = await rufen("POST /crm/firma/:id/kunde", {
    nutzer: a, params: { id: String(firma.id) }, query: {},
    body: { abschnitt: "alles", dabei: ["stammdaten"], besitzer: b.id, gewonnen_durch: a.id },
  }).catch((e) => { absturz = e; return null; });

  melde(!absturz, "Speichern stuerzt nicht ab" + (absturz ? ` — ${String(absturz.message).slice(0, 90)}` : ""));
  melde(!!antwort && !!antwort.redirect, "Die Akte leitet nach dem Speichern zurueck");

  const { rows: [fNach] } = await crm.system(
    `select besitzer, gewonnen_durch from firmen where id = $1`, [firma.id]);
  melde(fNach && String(fNach.besitzer) === String(b.id), `Die Firma gehoert jetzt ${b.name}`);
  melde(fNach && String(fNach.gewonnen_durch) === String(a.id),
    `Geholt hat sie weiterhin ${a.name} (der Umsatz bleibt bei ihm)`);

  const { rows: [dNach] } = await crm.system(`select besitzer from deals where id = $1`, [deal.id]);
  melde(dNach && String(dNach.besitzer) === String(b.id), "Der Deal ist mitgewandert");

  // Der Uebergebende darf danach nicht mehr hineinschreiben — sonst schrieben
  // zwei Leute in dieselbe Akte, ohne voneinander zu wissen.
  const { rows: nochDa } = await crm.system(
    `select 1 from firmen where id = $1 and besitzer = $2`, [firma.id, a.id]);
  melde(!nochDa.length, `${a.name} ist nicht mehr Verantwortlicher`);

  // ------------------------------------- Fremde Zeilen bleiben unantastbar
  // Die gelockerte Pruefung darf NUR regeln, worauf man etwas setzen darf —
  // nicht, was man anfassen darf.
  const fremdName = "ZZ Testfirma Fremd " + process.pid;
  await crm.leadsAnlegen(chef, [{ name: fremdName, telefon: "+49 89 5555" + String(process.pid).slice(-4) }],
    { sparte: "webdesign", besitzer: chef.id });
  const { rows: [fremd] } = await crm.system(`select id from firmen where name = $1`, [fremdName]);
  await crm.kundeAendern(a, fremd.id, { ort: "Von Fremd geaendert" }).catch(() => {});
  const { rows: [fremdNach] } = await crm.system(`select ort, besitzer from firmen where id = $1`, [fremd.id]);
  melde(fremdNach.ort !== "Von Fremd geaendert",
    "Ein Mitarbeiter aendert fremde Akten weiterhin nicht");
  melde(String(fremdNach.besitzer) === String(chef.id), "…und kann sie sich auch nicht selbst zuschreiben");

  // ---------------------------------------------------- Webseite als Link
  const wNull = "ZZ Testfirma Ohne Seite " + process.pid;
  const wPlatz = "ZZ Testfirma Platzhalter " + process.pid;
  const wOhneProto = "ZZ Testfirma Ohne Protokoll " + process.pid;
  await crm.leadsAnlegen(a, [
    { name: wNull, telefon: "+49 89 6001" + String(process.pid).slice(-4), website: "" },
    { name: wPlatz, telefon: "+49 89 6002" + String(process.pid).slice(-4), website: "keine" },
    { name: wOhneProto, telefon: "+49 89 6003" + String(process.pid).slice(-4), website: "beispiel-test.de" },
  ], { sparte: "webdesign", besitzer: a.id });

  const { rows: gespeichert } = await crm.system(
    `select name, website from firmen where name in ($1,$2,$3)`, [wNull, wPlatz, wOhneProto]);
  const hol = (n) => (gespeichert.find((r) => r.name === n) || {}).website;
  melde(!hol(wPlatz), '„keine" wird beim Import gar nicht erst gespeichert');
  melde(hol(wOhneProto) === "https://beispiel-test.de",
    "Eine Adresse ohne Protokoll bekommt https:// (und bleibt ein echter Link)");

  const liste = await rufen("GET /crm/leads", { nutzer: a, query: { suche: "ZZ Testfirma" } });
  // Die ganze Tabellenzeile herausschneiden, nicht die ersten N Zeichen ab dem
  // Namen: Eine Zeile traegt zwei Auswahlfelder mit Dutzenden Eintraegen, und
  // die Webseite steht dahinter. Ein fester Ausschnitt haette sie verfehlt und
  // waere als "kein Link" durchgegangen — ein Test, der aus dem falschen Grund
  // gruen ist, ist schlimmer als keiner.
  const zeile = (n) => {
    const zeilen = liste.html.split("<tr ");
    return zeilen.find((z) => z.includes(`data-name="${n}"`)) || "";
  };
  melde(!/href="keine"/.test(liste.html), "Kein Link mit href=\"keine\" auf der Seite");
  melde(zeile(wPlatz).includes("<td>—</td>"), "Ohne Webseite steht ein Strich, kein Link");
  melde(zeile(wOhneProto).includes('href="https://beispiel-test.de"'),
    "Mit Webseite steht ein Link auf die echte Adresse");

  // ------------------------------------------------------------------ Aufraeumen
  const weg = await crm.system(`delete from firmen where name like 'ZZ Testfirma %'`);
  console.log(`\nAufgeraeumt: ${weg.rowCount} Testfirmen entfernt.`);

  await crm.pool.end();
  console.log(fehler ? `\n${fehler} Problem(e).` : "\nAlles sauber.");
  process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error("FEHLER:", e.stack || e.message); process.exit(1); });
