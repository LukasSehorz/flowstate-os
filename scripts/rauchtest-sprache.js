// Rauchtest fuers Verstehen — mit ECHTER API, gegen einen erfundenen STAND.
//
// Warum es das braucht (26.07., A4): scripts/test-sprache.js prueft die
// Verdrahtung mit Stubs und war komplett gruen, waehrend die eigentliche
// Frage offen blieb — ruft das Modell die richtigen Werkzeuge auf? Das kann
// kein Stub beantworten, denn der Stub ist ja gerade die vorweggenommene
// Antwort. Beim Umbau auf Werkzeuge war das die groesste offene Stelle.
//
// Der STAND unten ist frei erfunden. Es wird NICHTS ausgefuehrt: Der Test
// ruft nur ausZustand() auf und schaut, was zurueckkommt — kein Termin wird
// eingetragen, keine Nachricht verschickt. Er kostet ein paar Cent.
//
// Laeuft ohne SCHNELL_API_KEY nicht und sagt das auch, statt gruen zu tun.
// Auf dem Server:  docker compose exec dashboard node scripts/rauchtest-sprache.js

process.env.VAULT_PATH = process.env.VAULT_PATH || "/app/vault";
const { ausZustand } = require("../lib/sprache-routes.js");

if (!process.env.SCHNELL_API_KEY) {
  console.log("⏭  Uebersprungen: SCHNELL_API_KEY nicht gesetzt (lokal normal — auf dem Server ein Problem).");
  process.exit(0);
}

const HEUTE = new Date();
const tag = (plus) => new Date(HEUTE.getTime() + plus * 864e5).toISOString().slice(0, 10);

const STAND = [
  `HEUTE: ${tag(0)}, 18:30 Uhr, Dorfen.`,
  "KALENDER heute: 14:00-15:00 Erstgespraech Physio Schwabing.",
  `KALENDER morgen (${tag(1)}): 09:00-11:00 Werkstatt, 16:00-17:00 Call Krotzer.`,
  `AUFGABEN offen: Angebot Krotzer rausschicken (faellig ${tag(2)}).`,
  "FIRMA: Sehorz & vom Hofe GbR, Performance Marketing. Team: Lukas, Jannik.",
  "PREISE: Betreuung ab 1.500 Euro im Monat.",
].join("\n");

// erwartet = die Werkzeuge, die kommen MUESSEN.
// verboten = die, die auf keinen Fall kommen duerfen (teure Umwege, falsche Spur).
const FAELLE = [
  { frage: "was steht morgen an", erwartet: [], verboten: ["lange_arbeit", "gehirn_suchen", "recherchieren"],
    sagt: /werkstatt|krotzer/i, warum: "Steht im STAND — muss ohne jeden Aufruf kommen." },
  { frage: "trag mir uebermorgen um neun Uhr Zahnarzt ein", erwartet: ["termin_eintragen"], verboten: ["lange_arbeit"],
    warum: "Kalender geht direkt, nie ueber den langen Weg." },
  { frage: "schieb den Call mit Krotzer auf halb sechs", erwartet: ["termin_verschieben"], verboten: ["lange_arbeit"] },
  { frage: "wie wird das Wetter morgen und sind neue Mails da", erwartet: ["wetter", "mail_lesen"], verboten: [],
    warum: "Zwei Anliegen, zwei parallele Aufrufe." },
  // Seit dem 27.07. muss der Werkzeugaufruf die FERTIGE Nachricht tragen, nicht
  // den Auftrag an das Modell. Vorher formulierte ein zweiter Modellaufruf nach
  // und kostete bis zu 6,2 Sekunden. Geprueft wird deshalb der Inhalt des
  // Aufrufs, nicht nur sein Name: Steht dort noch "schreib ihm, dass ...",
  // ist der alte Vertrag zurueck.
  { frage: "schreib Jannik dass ich mich morgen melde", erwartet: ["whatsapp_senden"], verboten: [],
    prueft: (a) => !/^(schreib|sag|frag|richte|teile|informier)\b/i.test(String(a.whatsapp?.text || "").trim()),
    warum: "Der Text muss abschickbar sein, kein Auftrag an dich selbst." },
  { frage: "wann hab ich morgen Zeit", erwartet: [], verboten: ["lange_arbeit", "gehirn_suchen"],
    sagt: /elf|11|frei|zwischen/i, warum: "Luecken liest das Modell selbst aus dem STAND ab." },
  // Zahlen duerfen ausgeschrieben sein ("eintausendfuenfhundert") — fuer eine
  // Stimme ist das sogar besser als "1.500", weil die Sprachausgabe daran
  // nicht stolpert. Der erste Entwurf pruefte nur auf Ziffern und hat genau
  // dieses gute Verhalten als Fehler gezaehlt.
  { frage: "was kostet bei uns die Betreuung", erwartet: [], verboten: ["gehirn_suchen", "recherchieren", "lange_arbeit"],
    sagt: /1\.?500|tausendf/i, warum: "Preise stehen im STAND — kein Umweg ueber die Suche." },
  { frage: "bau mir eine PowerPoint ueber Performance Marketing", erwartet: ["lange_arbeit"], verboten: [] },
  // Bewusst etwas, das NICHT im STAND steht. Der erste Entwurf dieses Falls
  // hiess "setz das Angebot fuer Krotzer auf die Liste" — das stand oben aber
  // schon als offene Aufgabe, und das Modell antwortete voellig richtig
  // "steht schon drauf". Der Test war falsch, nicht die Antwort.
  { frage: "setz Steuerunterlagen sortieren auf die Liste", erwartet: ["aufgabe_anlegen"], verboten: ["lange_arbeit"] },
  { frage: "notier bei Krotzer dass sie erst im September Budget haben", erwartet: ["crm_notiz"], verboten: [] },
];

let fehler = 0;
(async () => {
  const dauern = [];
  for (const f of FAELLE) {
    const a = await ausZustand(f.frage, STAND, []);
    const d = a._diag;
    const gerufen = d.aufrufe;
    dauern.push(d.dauerMs);

    const fehlt = f.erwartet.filter((w) => !gerufen.includes(w));
    const zuviel = f.verboten.filter((w) => gerufen.includes(w));
    const sagtFalsch = f.sagt && !f.sagt.test(a.text);
    // prueft() schaut in den INHALT des Aufrufs, nicht nur auf seinen Namen —
    // "richtiges Werkzeug mit unbrauchbarem Inhalt" ist sonst ein blinder Fleck.
    const inhaltFalsch = f.prueft && !f.prueft(a);
    const ok = !fehlt.length && !zuviel.length && !sagtFalsch && !inhaltFalsch && !d.fehler;

    console.log(`${ok ? "✅" : "❌"} "${f.frage}"`);
    console.log(`   ${d.dauerMs} ms · ${gerufen.length ? gerufen.join(" + ") : "kein Aufruf"} · ${d.tokenRaus} Token (davon ${d.tokenDenken} gedacht) · Speicher ${d.speicher}`);
    if (a.whatsapp) console.log(`   Nachricht: „${a.whatsapp.text}“`);
    if (a.text) console.log(`   sagt: ${a.text}`);
    if (!ok) {
      fehler++;
      if (fehlt.length) console.log(`   ⚠ fehlt: ${fehlt.join(", ")}${f.warum ? " — " + f.warum : ""}`);
      if (zuviel.length) console.log(`   ⚠ unnoetig: ${zuviel.join(", ")}${f.warum ? " — " + f.warum : ""}`);
      if (sagtFalsch) console.log(`   ⚠ gesagter Text passt nicht zu ${f.sagt}${f.warum ? " — " + f.warum : ""}`);
      if (inhaltFalsch) console.log(`   ⚠ Inhalt des Aufrufs unbrauchbar${f.warum ? " — " + f.warum : ""}`);
      if (d.fehler) console.log(`   ⚠ Fehler: ${d.fehler}`);
    }
    if (d.intern.length) console.log(`   ⚠ interner Begriff durchgerutscht: ${d.intern.join(", ")}`);
  }

  const s = [...dauern].sort((x, y) => x - y);
  console.log(`\nStellung:  ${process.env.SPRACHE_DENKEN || "adaptiv"} / ${process.env.SPRACHE_AUFWAND || "low"}`);
  console.log(`Verstehen: Median ${s[Math.floor(s.length / 2)]} ms · langsamste ${s[s.length - 1]} ms`);
  console.log(`Treffer:   ${FAELLE.length - fehler} von ${FAELLE.length}`);
  console.log(fehler ? `${fehler} von ${FAELLE.length} Faellen daneben.` : `Alle ${FAELLE.length} Faelle sauber.`);
  process.exit(fehler ? 1 : 0);
})();
