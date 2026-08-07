// Word-Datei zu PDF.
//
// Warum (07.08.2026): In Lukas' Bestand liegt zu jeder Rechnung eine .docx UND
// eine PDF im Unterordner "PDF" — die .docx ist die Arbeitsdatei, die PDF geht
// zum Kunden. Eine Word-Datei zu verschicken waere ein Rueckschritt: der Kunde
// koennte sie aendern, und je nach seiner Word-Version sieht sie anders aus.
//
// Gewandelt wird mit LibreOffice im Hintergrund (siehe Dockerfile). Das ist
// dasselbe Programm, das die Vorlage auch lesen kann — kein zweiter Weg, auf
// dem das Aussehen abweichen koennte.
//
// WENN ES NICHT DA IST, wird nicht abgebrochen: Der Aufrufer bekommt die .docx
// und den Hinweis. Lieber eine Rechnung im falschen Dateiformat als gar keine —
// aber der Hinweis muss durchgereicht werden, sonst verschickt Alexandra
// stillschweigend etwas anderes als angekuendigt.

const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

// LibreOffice braucht beim ersten Start ein eigenes Profil (~2 s). Ein fester
// Ort statt eines Wegwerfordners spart das bei jedem weiteren Mal.
const PROFIL = path.join(os.tmpdir(), "lo-profil");

let verfuegbar = null;
function daIst() {
  if (verfuegbar !== null) return verfuegbar;
  verfuegbar = ["/usr/bin/soffice", "/usr/lib/libreoffice/program/soffice"].some((p) => {
    try { return fs.statSync(p).isFile(); } catch { return false; }
  });
  return verfuegbar;
}

// Gibt { pdf: Buffer } oder { pdf: null, hint } zurueck. Wirft nicht.
function wandeln(docx, timeoutMs = 60000) {
  return new Promise((fertig) => {
    if (!daIst()) return fertig({ pdf: null, hint: "Kein PDF-Wandler im Container" });

    // Eigener Ordner je Wandlung: LibreOffice legt die PDF neben die Quelle und
    // benennt sie nach ihr. Zwei gleichzeitige Laeufe im selben Ordner wuerden
    // sich sonst die Datei wegnehmen.
    let ordner;
    try { ordner = fs.mkdtempSync(path.join(os.tmpdir(), "beleg-")); }
    catch (e) { return fertig({ pdf: null, hint: String(e.message).slice(0, 100) }); }

    const quelle = path.join(ordner, "beleg.docx");
    const aufraeumen = () => { try { fs.rmSync(ordner, { recursive: true, force: true }); } catch {} };

    try { fs.writeFileSync(quelle, docx); }
    catch (e) { aufraeumen(); return fertig({ pdf: null, hint: String(e.message).slice(0, 100) }); }

    execFile("soffice",
      ["--headless", "--norestore", `-env:UserInstallation=file://${PROFIL}`,
       "--convert-to", "pdf", "--outdir", ordner, quelle],
      { timeout: timeoutMs },
      (err) => {
        const ziel = path.join(ordner, "beleg.pdf");
        let pdf = null;
        try { if (fs.statSync(ziel).size > 0) pdf = fs.readFileSync(ziel); } catch {}
        aufraeumen();
        // Der Rueckgabewert von soffice ist unzuverlaessig — es meldet auch bei
        // gelungener Wandlung gelegentlich einen Fehler. Massgeblich ist, ob
        // eine brauchbare PDF entstanden ist.
        if (pdf && pdf.slice(0, 4).toString() === "%PDF") return fertig({ pdf });
        fertig({ pdf: null, hint: err ? String(err.message).slice(0, 100) : "PDF unbrauchbar" });
      });
  });
}

module.exports = { wandeln, daIst };
