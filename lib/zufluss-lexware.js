// lib/zufluss-lexware.js — Buchhaltung ueber die Lexware-Office-/lexoffice-
// Public-API (P3.7). Zieht die OFFENEN Ausgangsrechnungen (was Kunden noch
// schulden) in den Zustand, damit Alexandra "wie viele offene Rechnungen?" in
// unter 2 Sekunden beantwortet. Ohne LEXWARE_API_KEY schlummert das Modul —
// nichts bricht, der Zustand hat dann einfach keinen Buchhaltungs-Abschnitt.
//
// API-Doku: https://developers.lexware.io  ·  Bearer-Auth mit dem API-Schluessel
// aus den Lexware-Office-Einstellungen (Oeffentliche API).

const BASE = process.env.LEXWARE_BASE_URL || "https://api.lexoffice.io";
const KEY = process.env.LEXWARE_API_KEY || "";

function verfuegbar() { return Boolean(KEY); }

async function api(pfad) {
  const r = await fetch(BASE + pfad, {
    headers: { Authorization: "Bearer " + KEY, Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`lexoffice ${r.status} ${t.slice(0, 120)}`);
  }
  return r.json();
}

// Offene (unbezahlte) Ausgangsrechnungen: Anzahl, Summe, davon ueberfaellig.
// lexoffice liefert die Liste in { content: [...] }; je Beleg u. a. openAmount
// (Restbetrag), totalAmount, dueDate, voucherStatus, contactName.
async function offeneRechnungen() {
  if (!KEY) return null;
  const d = await api("/v1/voucherlist?voucherType=invoice&voucherStatus=open&size=250");
  const items = Array.isArray(d.content) ? d.content : [];
  const betrag = (v) => Number(v.openAmount ?? v.totalAmount ?? 0);
  const heute = new Date().toISOString().slice(0, 10);
  const faellig = items.filter((v) => v.dueDate && String(v.dueDate).slice(0, 10) < heute);
  return {
    anzahl: items.length,
    summe: Math.round(items.reduce((s, v) => s + betrag(v), 0)),
    ueberfaellig_anzahl: faellig.length,
    ueberfaellig_summe: Math.round(faellig.reduce((s, v) => s + betrag(v), 0)),
    stand: Date.now(),
  };
}

module.exports = { verfuegbar, offeneRechnungen };
