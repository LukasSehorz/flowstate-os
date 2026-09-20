// scripts/whiteboard-haertetest/gemeinsam.js — was alle drei Runden teilen.
//
// BASIS   Adresse der Probe; der Laeufer (scripts/whiteboard-haertetest.js)
//         startet sie selbst und reicht sie ueber WB_TEST_BASIS herein.
// CHROME  ein installiertes Chrome. puppeteer-core bringt bewusst keinen
//         eigenen Browser mit (300 MB im Repo-Alltag waeren zu viel) — also
//         je Betriebssystem der uebliche Ort, oder ausdruecklich CHROME=… .
// BILDER  Bildschirmfotos landen unter shots/ (steht in .gitignore).
const fs = require("fs"), path = require("path");

const ORTE = {
  darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
  win32: ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
          "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"],
  linux: ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"],
};
const CHROME = process.env.CHROME
  || (ORTE[process.platform] || []).find((ort) => fs.existsSync(ort))
  || "";

const BILDER = path.join(__dirname, "..", "..", "shots", "whiteboard-haertetest");
fs.mkdirSync(BILDER, { recursive: true });

module.exports = {
  BASIS: process.env.WB_TEST_BASIS || "http://localhost:3970",
  CHROME,
  BILDER,
};
