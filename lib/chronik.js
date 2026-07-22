// lib/chronik.js — der erste Zufluss ins zweite Gehirn.
//
// Schreibt einen Aggregat-Snapshot der Firmenzahlen als Markdown in den Vault
// (chronik/YYYY-MM-DD.md). Ueber die Zeit entsteht ein Verlauf, den Lukas in
// Obsidian durchblaettern kann — der Anfang des "zweiten Gehirns". Bewusst nur
// Zahlen: keine Kundendaten (DSGVO). Kostet keine Token — reine SQL-Aggregate.

const vault = require("./vault.js");
const crm = require("./crm.js");
const zustand = require("./zustand.js");

const berlinHeute = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date()); // YYYY-MM-DD
const eur = (n) => Number(n || 0).toLocaleString("de-DE", { maximumFractionDigits: 0 }) + " EUR";

async function schreibeTagesSnapshot() {
  if (!vault.schreibbar()) return { ok: false, grund: "Vault-Schreibbereich nicht beschreibbar (Mount :ro?)." };

  const datum = berlinHeute();
  const [k, team] = await Promise.all([
    crm.kennzahlenGesamt().catch(() => null),
    crm.teamZahlenGesamt().catch(() => []),
  ]);

  // Kalender: nur die ANZAHL der Termine heute — keine Titel, die koennten
  // Kundennamen enthalten und gehoeren damit nicht in den Git-Vault.
  let termineHeute = null;
  try {
    const z = zustand.lesen();
    if (Array.isArray(z.kalender)) {
      termineHeute = z.kalender.filter((t) => String(t.start).slice(0, 10) === datum).length;
    }
  } catch { /* Kalender optional */ }

  const jetzt = new Date().toLocaleString("de-DE", { timeZone: "Europe/Berlin" });
  const lang = new Date().toLocaleDateString("de-DE",
    { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Berlin" });

  const z = [];
  z.push("---", "typ: chronik", "datum: " + datum, "erzeugt: " + jetzt, "---", "");
  z.push("# Firmen-Chronik · " + lang, "");
  if (k) {
    z.push("## Kennzahlen");
    z.push(`- **Leads:** ${k.leads} · **Kunden:** ${k.kunden}`);
    z.push(`- **Offene Deals:** ${k.offene_deals} · **Pipeline:** ${eur(k.pipeline_wert)}`);
    z.push(`- **Gewonnen (Monat):** ${k.gewonnen_monat} · **Umsatz (Monat):** ${eur(k.umsatz_monat)}`);
    z.push(`- **Verloren (Monat):** ${k.verloren_monat} · **Neue Leads heute:** ${k.neue_leads_heute}`);
    z.push(`- **Fällige Wiedervorlagen:** ${k.wiedervorlagen} · **Offene Aufgaben:** ${k.offene_aufgaben}`);
    if (termineHeute != null) z.push(`- **Termine heute:** ${termineHeute}`);
    z.push("");
  } else {
    z.push("_Kennzahlen heute nicht abrufbar._", "");
  }
  if (team && team.length) {
    z.push("## Team (intern)");
    z.push("| Person | Rolle | Leads | Kunden | Offen | Gewonnen | Umsatz/Monat | Anrufe heute |");
    z.push("|---|---|--:|--:|--:|--:|--:|--:|");
    for (const p of team) {
      z.push(`| ${p.name} | ${p.rolle} | ${p.leads} | ${p.kunden} | ${p.offen} | ${p.gewonnen} | ${eur(p.umsatz_monat)} | ${p.anrufe_heute} |`);
    }
    z.push("");
  }
  z.push("> Automatisch vom zweiten Gehirn erzeugt. Nur Aggregatzahlen — keine Kundendaten (DSGVO).");

  const pfad = vault.schreibe(datum + ".md", z.join("\n") + "\n");
  return { ok: true, pfad, datum, kennzahlen: k };
}

module.exports = { schreibeTagesSnapshot };
