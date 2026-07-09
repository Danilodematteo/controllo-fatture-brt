// lib/parseInvoice.js
// Estrae numero fattura, data e righe spedizione dal testo del PDF BRT.
//
// La fattura BRT ha DUE colonne di peso per ogni spedizione:
//  - "PESO REALE" (es. 49,0) -> il peso vero dichiarato da BRT
//  - "PESO TASS." (es. 150)  -> il peso usato per calcolare il TRASPORTO,
//    spesso gonfiato dal calcolo volumetrico previsto da contratto
// Il confronto va fatto sul peso reale, non su quello tassabile.
//
// Ogni spedizione, oltre al TRASPORTO, ha altre voci "VARIE" (handling,
// fuel surcharge, ecc.) che si estendono su più righe del PDF. Il testo
// grezzo di tutto il blocco viene conservato così com'è (utile per la mail
// a Daniele) e la somma di tutti gli importi extra viene calcolata per
// ottenere il totale realmente pagato per quella spedizione.

function extractHeader(text) {
  const m = text.match(/(\d{2}\/\d{2}\/\d{2,4})\s+(\d{4,6})\s*\(\d+\)/);
  if (!m) return null;
  const parts = m[1].split("/");
  let yyyy = parts[2].length === 2 ? "20" + parts[2] : parts[2];
  return { data: `${yyyy}-${parts[1]}-${parts[0]}`, numero: m[2] };
}

const LEGENDA_CODICI = {
  j: "HANDLING", s: "SAFETY", U: "RITIRO", b: "AD.GEST.C.", f: "FUEL SURCHARGE",
  L: "I.S.T.A.T.", Z: "AD.GEST.AP.", K: "LOC.DISAGIATA", i: "COLLI INCOMPATIBILI",
  I: "SPESE GIACENZA", g: "TRAGHETTI", G: "COMP.ASSEGNO", P: "CONSEGNA AI PIANI",
  J: "ISOLA", "*": "DIROTTAMENTO", Q: "ZTL", u: "SPONDA IDRAULICA",
};

function parseInvoiceText(text) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const rows = [];
  const unparsed = [];
  const skipRe = /SPEDIZIONE|MITTENTE|NOMINATIVO|BRT S\.p\.A|Totale|TOTALE|Riporto|Legenda|Tot\.Cli|PARTENZA|ARRIVO|DATA FATTURA|CODICE CLIENTE|IMPONIBILE|Aliquota|CONDIZIONI|Spett|Fattura -|Partita IVA|^EUR/i;
  const rowRe = /(\d{6,13})\s+\d{3,4}\s+(?:(\d+)\s+)?([A-Z]{2})\s+([A-Z]{2})\s+([A-Z][A-Z'\.\s]*?)\s+(\d{5})\s+(\d{1,3})\s+([\d,\.]+)\s+([\d,\.]+)\s+(\d{1,3})\s+([\d,\.]+)([a-zA-Z\*])/;
  const pianoRe = /(\d+,\d{3})P(?![a-zA-Z])/;

  function closeCurrent(current) {
    if (!current) return;
    const varieText = current.varieLines.join(" ");
    const numeriVarie = (varieText.match(/\d+,\d{3}/g) || []).map((n) => parseFloat(n.replace(",", ".")));
    const varieSum = numeriVarie.reduce((s, n) => s + n, 0);
    const codici = (varieText.match(/\d+,\d{3}([A-Za-z\*])/g) || []).map((tok) => {
      const code = tok.slice(-1);
      const amount = parseFloat(tok.slice(0, -1).replace(",", "."));
      return { code, label: LEGENDA_CODICI[code] || code, amount };
    });
    // Il codice isola (J) a volte è attaccato al trasporto stesso, non a una voce "varie" separata:
    // in quel caso non è un importo a parte, ma segnala che quella spedizione ha tariffa isola.
    if (current.codiceTrasporto === "J") {
      codici.unshift({ code: "J", label: LEGENDA_CODICI.J, amount: null });
    }
    const pianoMatch = varieText.match(pianoRe) || current.anchorLine.match(pianoRe);
    rows.push({
      sped: current.sped,
      riferimento: current.riferimento || "",
      nominativo: current.nominativo.trim(),
      cap: current.cap,
      colli: current.colli,
      provinciaPartenza: current.provinciaPartenza,
      provinciaArrivo: current.provinciaArrivo,
      pesoReale: current.pesoReale,
      peso: current.pesoTass, // peso tassabile, tenuto solo come riferimento
      trasporto: current.trasporto,
      varieSum: Math.round(varieSum * 1000) / 1000,
      fatturato: Math.round((current.trasporto + varieSum) * 1000) / 1000,
      varieDettaglio: codici,
      pianoAmount: pianoMatch ? parseFloat(pianoMatch[1].replace(",", ".")) : null,
      rawText: current.allLines.join("\n"),
    });
  }

  let current = null;
  lines.forEach((line) => {
    if (skipRe.test(line)) {
      closeCurrent(current);
      current = null;
      return;
    }
    const m = line.match(rowRe);
    if (m) {
      closeCurrent(current);
      const [, sped, riferimento, provinciaArrivo, provinciaPartenza, nominativo, cap, colli, , pesoReale, pesoTass, trasporto, codiceTrasporto] = m;
      current = {
        sped, riferimento: riferimento || "", provinciaPartenza, provinciaArrivo, nominativo, cap,
        colli: parseInt(colli, 10) || 1,
        codiceTrasporto,
        pesoReale: parseFloat(pesoReale.replace(",", ".")),
        pesoTass: parseFloat(pesoTass.replace(",", ".")),
        trasporto: parseFloat(trasporto.replace(",", ".")),
        anchorLine: line,
        varieLines: [line.slice(m.index + m[0].length - 1)], // dal codice del trasporto in poi
        allLines: [line],
      };
    } else if (current) {
      current.varieLines.push(line);
      current.allLines.push(line);
    } else if (/^\d{6,}/.test(line) && line.length > 15 && !/^\d{6,}\s+[A-Z' .]+$/.test(line)) {
      unparsed.push(line);
    }
  });
  closeCurrent(current);

  return { rows, unparsed };
}

module.exports = { extractHeader, parseInvoiceText, LEGENDA_CODICI };

