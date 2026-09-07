// Passwort vergessen — zuruecksetzen, ohne angemeldet zu sein (06.09.2026).
//
// WARUM ES DAS GIBT: Ioannis kam nicht mehr in sein Konto. Das alte Passwort
// laesst sich nicht herausfinden (bcrypt ist eine Einbahnstrasse, und das ist
// richtig so), und aendern konnte man es bis heute nur ANGEMELDET. Lukas:
// "Das kommt immer mal wieder vor, und dann muss man es zuruecksetzen
// koennen, auch wenn man nicht ins System reinkommt."
//
// WARUM EIN LINK UND KEIN PASSWORT IN DER MAIL: Lukas hat gesagt, es solle
// "ein Passwort an die Mail geschickt" werden. Der Weg hier schickt
// stattdessen einen Link, der eine Stunde gilt und genau einmal funktioniert.
// Der Grund ist der Unterschied danach: Ein zugeschicktes Passwort liegt fuer
// immer im Postfach und oeffnet das Konto noch in einem Jahr — wer die Mail
// spaeter in die Finger bekommt (weitergeleitetes Postfach, altes Handy,
// durchsuchbares Archiv), kommt damit hinein. Der Link ist nach dem Setzen
// wertlos. Fuer den Menschen davor ist es derselbe Ablauf: klicken, neues
// Passwort eintippen, fertig — und er muss sich nichts merken, was jemand
// anders auch schon gesehen hat.
//
// WAS BEWUSST NICHT PASSIERT: Die Seite verraet nie, ob es zu einer Adresse
// ein Konto gibt. Sie antwortet immer gleich. Sonst waere sie ein Werkzeug,
// um Adressen durchzuprobieren ("gibt es hier einen Ioannis?").
//
// Der Schluessel steht NUR in der Mail. In der Datenbank liegt sein
// SHA-256-Abdruck; ein Blick in die Tabelle nuetzt niemandem etwas.

const crypto = require("crypto");
const crm = require("./crm.js");

const GUELTIG_MINUTEN = 60;
const MINDESTLAENGE = 10;
// Mehr als das in einer Stunde ist keine Vergesslichkeit mehr, sondern jemand,
// der die Seite als Mailschleuder benutzt. Der Zaehler laeuft je KONTO, nicht
// je Adresse — sonst umginge man ihn mit Gross- und Kleinschreibung.
const MAX_JE_STUNDE = 3;

const abdruck = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");

// Ein Schluessel, der in einer Adresszeile keinen Aerger macht und den man
// zur Not auch abtippen koennte: 32 zufaellige Bytes als base64url.
const schluesselBauen = () => crypto.randomBytes(32).toString("base64url");

function mailText({ name, url }) {
  return {
    betreff: "Neues Passwort fuer das Flowstate OS",
    text: [
      `Hallo ${name || ""},`.trim(),
      "",
      "du hast ein neues Passwort fuer das Flowstate OS angefordert.",
      "Ueber diesen Link kannst du dir eines setzen:",
      "",
      url,
      "",
      `Der Link gilt eine Stunde und funktioniert genau einmal.`,
      "",
      "Warst du das nicht, kannst du diese Mail wegwerfen — dein bisheriges",
      "Passwort bleibt dann unveraendert gueltig.",
      "",
      "Flowstate OS",
    ].join("\n"),
  };
}

// Schritt 1: Jemand hat seine Adresse eingetippt.
// Liefert IMMER {ok:true}, egal ob es das Konto gibt — siehe Kopfkommentar.
// "gesendet" sagt nur dem Serverprotokoll, was wirklich passiert ist.
async function anfordern(email, { basisUrl, von = "" } = {}) {
  const adresse = String(email || "").trim();
  if (!adresse || !adresse.includes("@")) return { ok: true, gesendet: false, grund: "keine-adresse" };

  let wer = null;
  try {
    const { rows } = await crm.system(
      `select u.id, u.email, p.name, p.aktiv
         from auth.users u join public.profiles p on p.id = u.id
        where lower(u.email) = lower($1)`, [adresse]);
    wer = rows[0] || null;
  } catch (e) {
    console.error("Passwort vergessen, Konto suchen:", e.message);
    return { ok: true, gesendet: false, grund: "datenbank" };
  }
  // Stillgelegte Konten bekommen keinen Link: Wer nicht mehr arbeiten soll,
  // soll sich auch nicht neu anmelden koennen.
  if (!wer || !wer.aktiv) return { ok: true, gesendet: false, grund: "kein-konto" };

  try {
    const { rows: [z] } = await crm.system(
      `select count(*)::int as n from public.passwort_zuruecksetzen
        where nutzer = $1 and erstellt > now() - interval '1 hour'`, [wer.id]);
    if (z && z.n >= MAX_JE_STUNDE) return { ok: true, gesendet: false, grund: "zu-oft" };
  } catch { /* Zaehlen ist Vorsicht, kein Muss */ }

  const schluessel = schluesselBauen();
  try {
    // Aeltere offene Schluessel derselben Person verfallen: Es soll immer nur
    // der zuletzt angeforderte Link gelten, sonst liegen mehrere gueltige
    // Schluessel gleichzeitig in verschiedenen Mails.
    await crm.system(
      `update public.passwort_zuruecksetzen set benutzt_am = now()
        where nutzer = $1 and benutzt_am is null and gueltig_bis > now()`, [wer.id]);
    await crm.system(
      `insert into public.passwort_zuruecksetzen (nutzer, schluessel_abdruck, gueltig_bis, angefragt_von)
       values ($1, $2, now() + ($3 || ' minutes')::interval, $4)`,
      [wer.id, abdruck(schluessel), String(GUELTIG_MINUTEN), String(von || "").slice(0, 60)]);
  } catch (e) {
    console.error("Passwort vergessen, Schluessel merken:", e.message);
    return { ok: true, gesendet: false, grund: "datenbank" };
  }

  const wurzel = String(basisUrl || process.env.OS_URL || "").replace(/\/+$/, "");
  const url = `${wurzel}/passwort-neu?schluessel=${encodeURIComponent(schluessel)}`;
  const { betreff, text } = mailText({ name: (wer.name || "").split(" ")[0], url });
  try {
    const mail = require("./gmail-direkt.js");
    const r = await mail.senden({ an: wer.email, betreff, text });
    if (!r || r.ok === false) {
      console.error("Passwort vergessen, Mail:", (r && r.hint) || "unbekannt");
      return { ok: true, gesendet: false, grund: "mail" };
    }
    return { ok: true, gesendet: true, abgefangen: !!r.abgefangen };
  } catch (e) {
    console.error("Passwort vergessen, Mail:", e.message);
    return { ok: true, gesendet: false, grund: "mail" };
  }
}

// Schritt 2: Der Link wurde angeklickt. Gibt die Person zurueck, wenn der
// Schluessel gilt — sonst warum nicht.
async function pruefen(schluessel) {
  const s = String(schluessel || "");
  if (!s) return { ok: false, grund: "kein-schluessel" };
  try {
    const { rows } = await crm.system(
      `select z.id, z.nutzer, z.gueltig_bis, z.benutzt_am, u.email, p.name, p.aktiv
         from public.passwort_zuruecksetzen z
         join auth.users u on u.id = z.nutzer
         join public.profiles p on p.id = z.nutzer
        where z.schluessel_abdruck = $1`, [abdruck(s)]);
    const z = rows[0];
    if (!z) return { ok: false, grund: "unbekannt" };
    if (z.benutzt_am) return { ok: false, grund: "benutzt" };
    if (new Date(z.gueltig_bis) <= new Date()) return { ok: false, grund: "abgelaufen" };
    if (!z.aktiv) return { ok: false, grund: "stillgelegt" };
    return { ok: true, id: z.id, nutzer: z.nutzer, email: z.email, name: z.name };
  } catch (e) {
    console.error("Passwort vergessen, pruefen:", e.message);
    return { ok: false, grund: "datenbank" };
  }
}

// Schritt 3: Neues Passwort setzen. Der Schluessel wird dabei verbraucht —
// und zwar in DERSELBEN Abfrage, die ihn als benutzt markiert: Zwei schnelle
// Aufrufe hintereinander sollen nicht beide durchgehen (update ... where
// benutzt_am is null trifft nur einmal).
async function setzen(schluessel, neu) {
  const passwort = String(neu || "");
  if (passwort.length < MINDESTLAENGE) return { ok: false, grund: "zu-kurz" };
  const gut = await pruefen(schluessel);
  if (!gut.ok) return gut;
  try {
    const { rowCount } = await crm.system(
      `update public.passwort_zuruecksetzen set benutzt_am = now()
        where id = $1 and benutzt_am is null`, [gut.id]);
    if (rowCount !== 1) return { ok: false, grund: "benutzt" };
    await crm.passwortAendern(gut.nutzer, passwort);
    console.log(`Passwort zurueckgesetzt fuer ${gut.email}`);
    return { ok: true, email: gut.email, name: gut.name };
  } catch (e) {
    console.error("Passwort vergessen, setzen:", e.message);
    return { ok: false, grund: "datenbank" };
  }
}

module.exports = { anfordern, pruefen, setzen, mailText, abdruck, schluesselBauen,
                   GUELTIG_MINUTEN, MINDESTLAENGE, MAX_JE_STUNDE };
