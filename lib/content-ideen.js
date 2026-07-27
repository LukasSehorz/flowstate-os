// Flowstate Content — Ideen und Skripte.
//
// Der Weg: Vorschlag -> Haken oder X -> bei Haken ein fertiges Skript.
//
// WORAUF DIE VORSCHLAEGE FUSSEN
//
// Drei Quellen, absteigend nach Verlaesslichkeit:
//
//   1. EURE EIGENEN ZAHLEN. Sobald genug Videos mit 24-Stunden- und 7-Tage-
//      Messung da sind, ist das die beste Quelle ueberhaupt — sie sagt, was bei
//      EURER Zielgruppe zieht, nicht was allgemein gerade laeuft. Die
//      staerksten und die schwaechsten Videos gehen beide in den Auftrag: aus
//      einem Flop lernt man genauso viel.
//
//   2. DAS FUNNEL-MODELL aus den beiden Quellen, die Jannik am 26.07. geschickt
//      hat (digibrood.com und funnel.io). Beide beschreiben dieselben drei
//      Kernstufen. Je Tag entsteht darum eine Idee JE STUFE — sonst entsteht
//      nur Reichweite und unten kommt nichts an.
//
//   3. WAS DIE IDEE NICHT IST: eine Abschrift eines fremden TikToks. TikTok
//      gibt keine Trenddaten heraus, und Abgreifen verstoesst gegen deren
//      Bedingungen. Was geht: Muster, die in Erklaervideos ueber TikTok
//      beschrieben werden, und die Uebertragung auf euer Thema.
//
// Verworfene Ideen bleiben stehen und gehen in den naechsten Auftrag mit ein.
// Sie sagen, was NICHT gefaellt — ohne sie schlaegt derselbe Einfall in zwei
// Wochen wieder auf.

const KLASSE = require("@anthropic-ai/sdk").default || require("@anthropic-ai/sdk");
const crm = require("./crm.js");
const ct = require("./content.js");
const alsNutzer = crm.alsNutzer;

const MODELL = process.env.IDEEN_MODELL || "claude-opus-5";

let klient = null;
function hol() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!klient) klient = new KLASSE({ apiKey: process.env.ANTHROPIC_API_KEY });
  return klient;
}
module.exports.bereit = () => Boolean(process.env.ANTHROPIC_API_KEY);

// ----------------------------------------------------------------- Ablage

module.exports.ideen = async function (user, { marke = null, status = null, kanal = null } = {}) {
  return alsNutzer(user.id, async (q) => {
    const { rows } = await q(
      `select i.*, p.name as marke_name, e.name as entschieden_name
         from content_ideen i
         left join profiles p on p.id = i.marke
         left join profiles e on e.id = i.entschieden_von
        where ($1::uuid is null or i.marke = $1)
          and ($2::text is null or i.status = $2)
          and ($3::text is null or i.kanal = $3)
        order by (i.status = 'vorschlag') desc, i.erstellt desc
        limit 80`, [marke, status, kanal]);
    return rows;
  });
};

module.exports.idee = async function (user, id) {
  return alsNutzer(user.id, async (q) => {
    const { rows } = await q(
      `select i.*, p.name as marke_name from content_ideen i
         left join profiles p on p.id = i.marke where i.id = $1`, [id]);
    return rows[0] || null;
  });
};

// Haken oder X. Beim Haken wird das Skript NICHT hier geschrieben — das macht
// die Route danach, damit das Speichern nicht am Modellaufruf haengt.
module.exports.entscheiden = async function (user, id, status) {
  if (!["angenommen", "verworfen"].includes(status)) return { ok: false, grund: "status" };
  return alsNutzer(user.id, async (q) => {
    // Verworfen werden darf auch noch NACH dem Annehmen: beim Lesen des
    // Skripts faellt oft erst auf, dass die Idee doch nichts taugt. Nur der
    // Weg zurueck von "verworfen" bleibt zu — sonst kaeme dieselbe Idee ueber
    // Umwege wieder in den Vorschlagstopf, aus dem sie gerade geflogen ist.
    const { rows } = await q(
      `update content_ideen
          set status = $2, entschieden_am = now(), entschieden_von = $3
        where id = $1
          and (status = 'vorschlag' or (status = 'angenommen' and $2 = 'verworfen'))
        returning *`, [id, status, user.id]);
    if (!rows.length) return { ok: false, grund: "schon-entschieden" };
    return { ok: true, idee: rows[0] };
  });
};

module.exports.ideeLoeschen = async function (user, id) {
  return alsNutzer(user.id, async (q) => {
    await q(`delete from content_ideen where id = $1`, [id]);
    return { ok: true };
  });
};

// Aus einer angenommenen Idee einen Eintrag im Redaktionsplan machen.
module.exports.inPlanUebernehmen = async function (user, id, geplantAm) {
  const i = await module.exports.idee(user, id);
  if (!i) return { ok: false, grund: "nicht-gefunden" };
  if (i.status !== "angenommen") return { ok: false, grund: "nicht-angenommen" };
  if (i.post_id) return { ok: false, grund: "schon-uebernommen" };

  // Ein Kurzvideo geht auf alle drei Videokanaele — dieselbe Regel wie im
  // Dialog. Die Idee traegt nur "TikTok", weil sie dort recherchiert wurde.
  const sorte = i.kanal === "YouTube Video" ? "Langvideo" : i.kanal === "X" ? "Beitrag" : "Kurzvideo";
  const kanaele = ct.SORTEN.find((s) => s.titel === sorte)?.kanaele || [i.kanal];

  // Landet direkt in der ersten Spalte der Produktionstafel: es muss gedreht
  // werden. "entwurf" hiess vorher dasselbe, sagte aber nicht, was zu tun ist.
  const r = await ct.postAnlegen(user, {
    // Der Titel der Idee IST der Aufhaenger — er wandert als Headline mit,
      // damit auf der Tafel steht, was im Video zuerst gesagt wird.
    // Auf der Tafel ist der Titel das ETIKETT (kurz, zum Wiedererkennen),
    // die Headline der gesprochene erste Satz. Frueher stand der Satz als
    // Titel da und man musste auf jeder Karte lesen statt zu erkennen.
    titel: i.ueberschrift || i.titel, ueberschrift: i.ueberschrift || i.titel,
    headline: i.titel, sorte, kanaele, status: "aufnehmen",
    geplant_am: geplantAm || null, marke: i.marke,
    rubrik: i.rubrik, funnel: i.funnel,
    notiz: i.idee,
  });
  if (!r.ok) return r;
  await alsNutzer(user.id, async (q) => {
    await q(`update content_ideen set post_id = $2 where id = $1`, [id, r.id]);
  });
  return { ok: true, post_id: r.id };
};

// Eine Idee von Hand. Nicht jede gute Idee kommt vom Modell — im Auto, unter
// der Dusche, beim Kunden. Sie muss genauso in den Ablauf koennen, sonst wird
// sie auf einen Zettel geschrieben und geht verloren.
module.exports.eigeneIdee = async function (user, d) {
  const titel = String(d.titel || "").trim();
  if (!titel) return { ok: false, grund: "titel" };
  if (!ct.KANAELE.includes(d.kanal)) return { ok: false, grund: "kanal" };
  return alsNutzer(user.id, async (q) => {
    const { rows } = await q(
      `insert into content_ideen (marke, kanal, rubrik, funnel, ueberschrift, titel, idee,
                                  status, skript, skript_am, entschieden_am,
                                  entschieden_von, quelle)
       -- $7 braucht den Cast: in "case when $7 is null" kann Postgres den Typ
       -- sonst nicht bestimmen und lehnt die ganze Anweisung ab.
       values ($1,$2,$3,$4,$8,$5,$6,'angenommen',$7::text,
               case when $7::text is null then null else now() end, now(), $1, 'hand')
       returning id`,
      [d.marke || user.id, d.kanal,
       ct.RUBRIKEN.some((r) => r.id === d.rubrik) ? d.rubrik : null,
       ct.FUNNEL.some((f) => f.id === d.funnel) ? d.funnel : null,
       titel.slice(0, 300),
       String(d.idee || "").trim().slice(0, 4000) || titel,
       String(d.skript || "").trim().slice(0, 20000) || null,
       String(d.ueberschrift || titel).trim().slice(0, 80)]);
    return { ok: true, id: rows[0].id };
  });
};

// ------------------------------------------------------ Auftrag an das Modell

// Was bei euch zieht und was nicht — beides geht in den Auftrag.
async function eigeneZahlen(user, marke) {
  return alsNutzer(user.id, async (q) => {
    const { rows } = await q(
      `with letzte as (
         select distinct on (post_id, kanal) *
           from content_zahlen order by post_id, kanal, messpunkt desc, gemessen_am desc
       )
       select p.titel, p.rubrik, p.funnel, p.notiz, z.kanal, z.views, z.likes,
              z.avg_sekunden, z.bis_ende_proz, z.neue_abos
         from content_posts p
         join letzte z on z.post_id = p.id
        where p.status = 'veroeffentlicht'
          and ($1::uuid is null or p.marke = $1)
          and z.views is not null
        order by z.views desc limit 40`, [marke]);
    return rows;
  });
}

// Schon Vorgeschlagenes und Verworfenes — damit nichts zweimal kommt.
async function bisher(user, marke) {
  return alsNutzer(user.id, async (q) => {
    const { rows } = await q(
      `select titel, status from content_ideen
        where ($1::uuid is null or marke = $1)
          and erstellt >= now() - interval '60 days'
        order by erstellt desc limit 120`, [marke]);
    return rows;
  });
}

const FIRMA = `Sehorz & vom Hofe GbR aus Traunstein, Oberbayern. Zwei Gründer,
Jannik vom Hofe und Lukas Sehorz. Drei Leistungen: Webdesign, Performance
Marketing (Google Ads, Meta Ads) und KI-Projekte (Automatisierungen,
Telefon-Agenten, interne Systeme). Kunden sind kleine und mittlere Betriebe in
der Region — vor allem Physiotherapie-Praxen, Ärzte und Zahnärzte, dazu
Handwerk, Gastronomie und Kanzleien. Kleinunternehmer nach §19 UStG.
Der Ton ist direkt und unaufgeregt, kein Agentur-Sprech, keine Superlative.`;

function auftrag({ kanal, rubrik, zahlen, frueher, anzahl }) {
  const stufen = ct.FUNNEL.filter((f) => f.id !== "bindung");
  return `Du entwickelst Content-Ideen für ein Personal-Brand-Konto auf ${kanal}.

# Das Unternehmen
${FIRMA}

# Das Funnel-Modell, nach dem gearbeitet wird
Aus zwei Quellen, die sich einig sind (digibrood.com, funnel.io). Drei Stufen:

${stufen.map((f) => `## ${f.kurz} — ${f.titel}
Der Zuschauer denkt: „${f.frage}"
Ziel: ${f.ziel}
Passende Inhalte: ${f.inhalte}
Gemessen wird: ${f.misst}`).join("\n\n")}

Der häufigste Fehler laut beiden Quellen: alles ist Reichweite (TOFU), und unten
kommt nichts an. Darum brauche ich **je Stufe eine Idee**, nicht drei für oben.

# Was bei diesem Konto tatsächlich funktioniert hat
${zahlen.length
  ? zahlen.slice(0, 20).map((z) =>
      `- „${z.titel}" (${z.kanal}, ${z.rubrik || "ohne Rubrik"}): ${z.views} Views, ${z.likes} Likes${
        z.avg_sekunden ? `, Ø ${z.avg_sekunden}s gesehen` : ""}${
        z.bis_ende_proz ? `, ${z.bis_ende_proz}% bis zum Ende` : ""}${
        z.notiz ? ` — Notiz: ${z.notiz}` : ""}`).join("\n")
  : "Noch keine eigenen Zahlen vorhanden. Arbeite ohne diese Quelle und sage das im Feld „warum“ nicht extra dazu."}

${zahlen.length >= 5 ? `Leite daraus ab, welche Hooks und Themen bei DIESER Zielgruppe ziehen.
Ein Video mit hoher Ø-Sehdauer bei mittleren Views ist oft das bessere Muster als
ein Ausreißer mit vielen Views und niedriger Sehdauer.` : ""}

# Schon vorgeschlagen — nicht wiederholen
${frueher.length
  ? frueher.map((f) => `- ${f.titel}${f.status === "verworfen" ? "  (VERWORFEN)" : ""}`).join("\n")
  : "Noch nichts vorgeschlagen."}

Verworfene Ideen zeigen, was nicht gefällt. Schlage nichts vor, was inhaltlich
in dieselbe Richtung geht.

# Rubrik
${rubrik === "lifestyle"
  ? `LIFESTYLE. Kein Fachthema. Was am Tag ansteht, was gerade gut lief, wo er
gerade ist, wie der Alltag als Gründer aussieht. Nahbar, nicht inszeniert. Die
Person soll greifbar werden — das ist der Zweck, nicht die Information.`
  : `FACHLICH zum Thema ${ct.RUBRIK_TITEL[rubrik] || rubrik}. Konkret und
überprüfbar, keine Allgemeinplätze. Lieber ein einzelner Fehler, den man wirklich
sieht, als „5 Tipps für bessere Websites".`}

# Auftrag
Entwickle ${anzahl} Ideen — je eine pro Funnel-Stufe (tofu, mofu, bofu).

Für jede Idee:
- titel: der Aufhänger in einem Satz, so wie er als Hook funktionieren würde
- idee: was im Video passiert. Konkret: was sieht man, was wird gesagt, wie ist
  der Ablauf. Drei bis fünf Sätze.
- warum: warum das zieht. Nenne das Muster (z. B. „Widerspruch im ersten Satz",
  „sichtbares Vorher-Nachher", „Zahl, die überrascht"). Ein bis zwei Sätze.
- beispiel: falls du ein bekanntes, real existierendes Format oder Video als
  Vergleich nennen kannst, beschreibe es. Erfinde KEINE Links und keine
  Videotitel, die du nicht sicher kennst — dann lass das Feld leer.

Schreib auf Deutsch, in dem Ton, den das Unternehmen verwendet. Keine
Superlative, kein Agentur-Sprech.`;
}

// Drei FESTE Felder statt einer Liste. Mit einer offenen Liste kamen fuenf
// Ideen statt drei, davon zwei fast wortgleiche Doppel — Mengenangaben wie
// minItems/maxItems werden bei strukturierter Ausgabe nicht durchgesetzt.
// Als benannte Felder ist genau eine Idee je Stufe die einzig moegliche Form,
// und die Zuordnung zur Stufe kann auch nicht mehr danebengehen.
const IDEE_FELD = {
  type: "object", additionalProperties: false,
  required: ["ueberschrift", "titel", "idee", "warum", "beispiel"],
  properties: {
    ueberschrift: { type: "string", description: "Etikett zum Wiedererkennen, 3 bis 6 Wörter. Kein Satz, keine Wertung. Beispiel: „Dialekt-Test Telefon-KI\", „Ladezeit 8,4 auf 1,1\"." },
    titel: { type: "string", description: "Der Aufhänger in einem Satz, so wie er als Hook funktioniert. Kein Punkt am Ende." },
    idee: { type: "string", description: "Was im Video passiert: was man sieht, was gesagt wird, wie der Ablauf ist. Drei bis fünf Sätze." },
    warum: { type: "string", description: "Warum das zieht — das Muster dahinter. Ein bis zwei Sätze. Nie leer." },
    beispiel: { type: "string", description: "Vergleichbares Format, das du sicher kennst. Leerer Text, wenn dir keins einfällt — erfinde nichts." },
  },
};
const SCHEMA_IDEEN = {
  type: "object", additionalProperties: false, required: ["tofu", "mofu", "bofu"],
  properties: { tofu: IDEE_FELD, mofu: IDEE_FELD, bofu: IDEE_FELD },
};

// Ideen erzeugen. anzahl ist die Zahl der Stufen — je Stufe eine.
module.exports.ideenErzeugen = async function (user, { marke, kanal = "TikTok", rubrik = "ki" } = {}) {
  const c = hol();
  if (!c) return { ok: false, grund: "kein-zugang" };
  if (!ct.KANAELE.includes(kanal)) return { ok: false, grund: "kanal" };
  if (!ct.RUBRIKEN.some((r) => r.id === rubrik)) return { ok: false, grund: "rubrik" };

  const [zahlen, frueher] = await Promise.all([
    eigeneZahlen(user, marke || null),
    bisher(user, marke || null),
  ]);

  try {
    const antwort = await c.messages.create({
      model: MODELL,
      max_tokens: 8000,
      output_config: { effort: "high", format: { type: "json_schema", schema: SCHEMA_IDEEN } },
      messages: [{ role: "user", content: auftrag({ kanal, rubrik, zahlen, frueher, anzahl: 3 }) }],
    });
    if (antwort.stop_reason === "refusal") return { ok: false, grund: "abgelehnt" };
    const text = (antwort.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    if (!text.trim()) return { ok: false, grund: "leer" };
    // Das Schema liefert drei BENANNTE Felder (tofu/mofu/bofu), keine Liste —
    // so ist genau eine Idee je Stufe die einzig moegliche Form und die
    // Zuordnung zur Stufe kann nicht danebengehen. Die Stufe steht also am
    // Schluessel, nicht in einem Feld, das das Modell selbst fuellen muesste.
    const antwortObjekt = JSON.parse(text);
    const stufen = ["tofu", "mofu", "bofu"];

    const angelegt = [];
    await alsNutzer(user.id, async (q) => {
      for (const stufe of stufen) {
        const i = antwortObjekt[stufe];
        if (!i || !i.titel || !i.idee) continue;
        const { rows } = await q(
          `insert into content_ideen (marke, kanal, rubrik, funnel, ueberschrift, titel,
                                      idee, warum, beispiel_quelle, quelle)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'ki') returning id`,
          [marke || user.id, kanal, rubrik, stufe,
           String(i.ueberschrift || i.titel).slice(0, 80),
           String(i.titel).slice(0, 300), i.idee, i.warum,
           String(i.beispiel || "").trim() || null]);
        angelegt.push(rows[0].id);
      }
    });
    if (!angelegt.length) return { ok: false, grund: "keine-verwertbare-idee" };
    return { ok: true, anzahl: angelegt.length, ids: angelegt };
  } catch (fehler) {
    return { ok: false, grund: "fehler", text: String(fehler.message).slice(0, 200) };
  }
};

// -------------------------------------------------------------- Aussortieren
//
// Wenn je Stufe schon genug offene Vorschlaege liegen, bringt Nachschieben
// nichts — die Liste wird nur unlesbar. Stattdessen wird VERGLICHEN und der
// schwaechere fliegt raus.
//
// Der Vergleich laeuft ueber dasselbe Modell, das die Ideen macht, aber mit
// einem anderen Auftrag: nicht erfinden, sondern zwischen vorliegenden
// Vorschlaegen entscheiden. Das ist ehrlicher als eine Regel wie "das
// Neuere gewinnt" — neuer heisst nicht besser, und eine gute Idee von
// vorgestern soll nicht verfallen, nur weil der Kalender weitergegangen ist.
const SCHEMA_AUSWAHL = {
  type: "object", additionalProperties: false, required: ["bleiben", "begruendung"],
  properties: {
    bleiben: { type: "array", items: { type: "integer" },
      description: "Die Kennungen der Ideen, die bleiben sollen — genau so viele wie verlangt." },
    begruendung: { type: "string", description: "Ein bis zwei Sätze: warum genau diese." },
  },
};

module.exports.aussortieren = async function (user, { marke, kanal, funnel, behalten = 2 }) {
  const c = hol();
  if (!c) return { ok: false, grund: "kein-zugang" };
  const offen = await alsNutzer(user.id, async (q) => {
    const { rows } = await q(
      `select id, ueberschrift, titel, idee, warum, erstellt from content_ideen
        where marke = $1 and kanal = $2 and funnel = $3 and status = 'vorschlag'
        order by erstellt`, [marke, kanal, funnel]);
    return rows;
  });
  if (offen.length <= behalten) return { ok: true, weg: 0 };

  const liste = offen.map((i) =>
    `## Idee ${i.id}\nÜberschrift: ${i.ueberschrift || "—"}\nHook: ${i.titel}\nAblauf: ${i.idee}\nWarum: ${i.warum || "—"}`).join("\n\n");

  try {
    const antwort = await c.messages.create({
      model: MODELL, max_tokens: 2000,
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA_AUSWAHL } },
      messages: [{ role: "user", content:
`Hier liegen ${offen.length} offene Content-Ideen für dieselbe Funnel-Stufe (${funnel.toUpperCase()}) auf ${kanal}.
Es sollen nur die besten ${behalten} übrig bleiben.

# Das Unternehmen
${FIRMA}

# Die Ideen
${liste}

# Woran du sie misst
1. Ist der Hook in den ersten zwei Sekunden überprüfbar konkret, oder ist er eine Behauptung?
2. Zeigt das Video etwas Echtes (Aufnahme, Zahl, Protokoll) oder wird nur geredet?
3. Passt es zur Stufe? TOFU muss Fremde halten, BOFU muss zur Entscheidung führen.
4. Ist es in ein bis zwei Stunden drehbar, ohne Team und ohne Studio?

Wähle genau ${behalten} aus und nenne ihre Kennungen.` }],
    });
    const text = (antwort.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    if (!text.trim()) return { ok: false, grund: "leer" };
    const { bleiben, begruendung } = JSON.parse(text);
    const behaltenIds = new Set((bleiben || []).map(Number));
    // Sicherheitsnetz: liefert das Modell Unsinn (zu viele, zu wenige, fremde
    // Kennungen), wird NICHT aussortiert. Lieber eine zu lange Liste als
    // geloeschte Ideen aufgrund einer kaputten Antwort.
    const gueltig = [...behaltenIds].filter((id) => offen.some((o) => Number(o.id) === id));
    if (gueltig.length !== behalten) return { ok: false, grund: "unbrauchbare-auswahl" };

    const raus = offen.filter((o) => !behaltenIds.has(Number(o.id)));
    await alsNutzer(user.id, async (q) => {
      for (const r of raus) {
        await q(`update content_ideen set status = 'verworfen', entschieden_am = now(),
                        warum = coalesce(warum, '') || $2
                  where id = $1`,
          [r.id, "\n\n[Ersetzt am " + new Date().toLocaleDateString("de-DE") +
                 " durch einen stärkeren Vorschlag: " + String(begruendung).slice(0, 300) + "]"]);
      }
    });
    return { ok: true, weg: raus.length, begruendung };
  } catch (fehler) {
    return { ok: false, grund: "fehler", text: String(fehler.message).slice(0, 200) };
  }
};

// ---------------------------------------------------------------- Das Skript

function skriptAuftrag(i, zahlen) {
  const stufe = ct.FUNNEL.find((f) => f.id === i.funnel);
  const kurz = i.kanal === "YouTube Video";
  return `Schreibe ein sendefertiges Skript für ${kurz ? "ein YouTube-Video" : "ein Kurzvideo"}.

# Das Unternehmen
${FIRMA}

# Die Idee, die freigegeben wurde
Titel: ${i.titel}
Rubrik: ${ct.RUBRIK_TITEL[i.rubrik] || i.rubrik || "—"}
Funnel-Stufe: ${stufe ? `${stufe.kurz} — ${stufe.titel}. Ziel: ${stufe.ziel}` : i.funnel}
Worum es geht: ${i.idee}
Warum das zieht: ${i.warum || "—"}

${zahlen.length >= 5 ? `# Was bei diesem Konto funktioniert hat
${zahlen.slice(0, 10).map((z) => `- „${z.titel}": ${z.views} Views, Ø ${z.avg_sekunden || "?"}s gesehen`).join("\n")}
Halte dich an diese Längen und diesen Rhythmus.` : ""}

# Was ich brauche

${kurz ? `Ein YouTube-Video von 6 bis 10 Minuten:
- Titel-Vorschläge: drei Stück
- Hook: die ersten 15 Sekunden, wörtlich
- Gliederung: die Abschnitte mit je zwei bis vier Sätzen, was gesagt und gezeigt wird
- Schluss: der Übergang zur Handlung (Erstgespräch, Website)
- Beschreibungstext für YouTube` : `Ein Kurzvideo von 30 bis 45 Sekunden für TikTok, YouTube Shorts und Instagram Reels:
- Hook: der erste Satz, WÖRTLICH. Er entscheidet alles. Maximal 8 Wörter.
- Skript: der komplette Text, den er spricht, wörtlich. Mit Zeitmarken.
- Bild: was dabei zu sehen ist — Aufnahme, Einblendung, Schnitt
- Schluss: der letzte Satz, der zur Handlung führt
- Beschreibung und drei bis fünf Hashtags`}

# Ton
Direkt, ohne Anlauf, kein Agentur-Sprech, keine Superlative. Wie jemand redet,
der die Sache kann und es nicht nötig hat, sich zu verkaufen. Duzen.
Keine Floskeln wie „In diesem Video zeige ich dir…" — sofort zur Sache.

Gib nur das Skript aus, keine Vorrede.`;
}

module.exports.skriptErzeugen = async function (user, id) {
  const c = hol();
  if (!c) return { ok: false, grund: "kein-zugang" };
  const i = await module.exports.idee(user, id);
  if (!i) return { ok: false, grund: "nicht-gefunden" };
  if (i.status !== "angenommen") return { ok: false, grund: "nicht-angenommen" };

  const zahlen = await eigeneZahlen(user, i.marke);
  try {
    const antwort = await c.messages.create({
      model: MODELL, max_tokens: 8000,
      output_config: { effort: "high" },
      messages: [{ role: "user", content: skriptAuftrag(i, zahlen) }],
    });
    if (antwort.stop_reason === "refusal") return { ok: false, grund: "abgelehnt" };
    const text = (antwort.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    if (!text) return { ok: false, grund: "leer" };
    await alsNutzer(user.id, async (q) => {
      await q(`update content_ideen set skript = $2, skript_am = now() where id = $1`, [id, text]);
    });
    return { ok: true, skript: text };
  } catch (fehler) {
    return { ok: false, grund: "fehler", text: String(fehler.message).slice(0, 200) };
  }
};

module.exports.MODELL = MODELL;
