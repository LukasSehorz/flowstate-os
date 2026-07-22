// lib/zufluss-meta.js — Meta-Ads-KPIs ueber die Marketing API (P3.7). Zieht
// Ausgaben, ROAS und Leads der letzten 7 Tage in den Zustand, damit "wie laufen
// die Ads?" sofort beantwortbar ist. Ohne META_ACCESS_TOKEN + META_AD_ACCOUNT_ID
// schlummert das Modul.
//
// Braucht: ein Meta-Developer-App-Token mit ads_read und die Werbekonto-ID
// (act_XXXXXXXX aus dem Werbeanzeigenmanager). Ein langlebiges Token empfohlen.

const VERSION = process.env.META_API_VERSION || "v21.0";
const TOKEN = process.env.META_ACCESS_TOKEN || "";
const KONTO = (process.env.META_AD_ACCOUNT_ID || "").replace(/^act_/, "");

function verfuegbar() { return Boolean(TOKEN && KONTO); }

// KPIs des Werbekontos ueber die letzten 7 Tage. Meta liefert { data: [ {...} ] };
// purchase_roas + actions sind Arrays, die wir auf einen Wert eindampfen.
async function kampagnenKpi() {
  if (!verfuegbar()) return null;
  const felder = "spend,impressions,clicks,ctr,cpc,purchase_roas,actions";
  const url = `https://graph.facebook.com/${VERSION}/act_${KONTO}/insights` +
    `?fields=${felder}&date_preset=last_7d&access_token=${encodeURIComponent(TOKEN)}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const d = await r.json();
  if (d.error) throw new Error("meta " + String(d.error.message || "").slice(0, 140));
  const row = (Array.isArray(d.data) ? d.data[0] : null) || {};
  const roas = Array.isArray(row.purchase_roas) && row.purchase_roas[0] ? Number(row.purchase_roas[0].value) : null;
  const leadAkt = Array.isArray(row.actions) ? row.actions.find((a) => /lead/i.test(a.action_type)) : null;
  return {
    ausgaben: row.spend != null ? Math.round(Number(row.spend)) : 0,
    impressionen: Number(row.impressions || 0),
    klicks: Number(row.clicks || 0),
    ctr: row.ctr != null ? Math.round(Number(row.ctr) * 100) / 100 : null,
    roas: roas != null ? Math.round(roas * 100) / 100 : null,
    leads: leadAkt ? Number(leadAkt.value) : null,
    zeitraum: "letzte 7 Tage",
    stand: Date.now(),
  };
}

module.exports = { verfuegbar, kampagnenKpi };
