// lib/parseInvoice.js
// Estrae numero fattura, data e righe spedizione dal testo del PDF BRT.
// Stessa logica già validata nell'app Claude, portata qui per il backend.

function extractHeader(text) {
  const m = text.match(/(\d{2}\/\d{2}\/\d{2,4})\s+(\d{4,6})\s*\(\d+\)/);
  if (!m) return null;
  const parts = m[1].split("/");
  let yyyy = parts[2].length === 2 ? "20" + parts[2] : parts[2];
  return { data: `${yyyy}-${parts[1]}-${parts[0]}`, numero: m[2] };
}

function parseInvoiceText(text) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const rows = [];
  const unparsed = [];
  const skipRe = /SPEDIZIONE|MITTENTE|NOMINATIVO|BRT S\.p\.A|Totale|TOTALE|Riporto|Legenda|Tot\.Cli|PARTENZA|ARRIVO|DATA FATTURA|CODICE CLIENTE|IMPONIBILE|Aliquota|CONDIZIONI|Spett|Fattura -|Partita IVA/i;
  const rowRe = /(\d{6,13})\s+\d{3,4}\s+(?:(\d+)\s+)?[A-Z]{2}\s+[A-Z]{2}\s+([A-Z][A-Z'\.\s]*?)\s+(\d{5})\s+(\d{1,3})\s+([\d,\.]+)\s+([\d,\.]+)\s+(\d{1,3})\s+([\d,\.]+)\s*[a-zA-Z*]/;
  const pianoRe = /(\d+,\d{3})P(?![a-zA-Z])/;

  lines.forEach((line) => {
    if (skipRe.test(line)) return;
    const m = line.match(rowRe);
    if (m) {
      const [, sped, riferimento, nominativo, cap, , , pesoReale, pesoTass, trasporto] = m;
      const pm = line.match(pianoRe);
      rows.push({
        sped,
        riferimento: riferimento || "",
        nominativo: (nominativo || "").trim(),
        cap,
        peso: parseFloat(pesoTass.replace(",", ".")),
        fatturato: parseFloat(trasporto.replace(",", ".")),
        pianoAmount: pm ? parseFloat(pm[1].replace(",", ".")) : null,
      });
    } else if (/^\d{6,}/.test(line) && line.length > 15 && !/^\d{6,}\s+[A-Z' .]+$/.test(line)) {
      unparsed.push(line);
    }
  });

  return { rows, unparsed };
}

module.exports = { extractHeader, parseInvoiceText };
