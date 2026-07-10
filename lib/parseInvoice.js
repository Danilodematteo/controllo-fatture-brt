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
  const m = text.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(\d{4,6})\s*\(\d+\)/);
  if (!m) return null;
  const parts = m[1].split("/");
  const dd = parts[0].padStart(2, "0");
  const mm = parts[1].padStart(2, "0");
  const yyyy = parts[2].length === 2 ? "20" + parts[2] : parts[2];
  return { data: `${yyyy}-${mm}-${dd}`, numero: m[2] };
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
  // Il PRINCIPIO DELLA SPEDIZIONE (sped, data, riferimento, province, nominativo,
  // cap, colli, volume, peso reale) è sempre scritto allo stesso modo — è quello
  // che identifica in modo affidabile l'inizio di una NUOVA spedizione.
  // Quello che segue il peso reale invece cambia parecchio da riga a riga:
  // a volte c'è peso tassabile + trasporto + codice varie, a volte manca il
  // tassabile, a volte manca anche il trasporto (spedizioni reso/giacenza),
  // a volte non c'è nessun codice attaccato. Prima li inseguivamo uno per uno
  // con regex diverse — ma ogni formato nuovo che spuntava fuori (mai visto
  // prima) veniva scambiato per continuazione della spedizione precedente,
  // sommandone i costi per errore. Ora il "resto della riga" si interpreta
  // sempre DOPO aver già riconosciuto la spedizione come nuova, qualunque
  // forma abbia: nel peggiore dei casi non troviamo trasporto/codice, ma non
  // fondiamo mai più due spedizioni diverse insieme.
  const rowStartRe = /(\d{5,13})\s+(\d{3,4})\s+(?:(\d+)\s+)?([A-Z]{2})\s+([A-Z]{2})\s+([A-Z][A-Z'\.\s]*?)\s+(\d{5})\s+(\d{1,3})\s+([\d,\.]+)\s+([\d,\.]+)(?=\s|$)/;
  const pianoRe = /(\d+,\d{3})P(?![a-zA-Z])/;

  // Interpreta cosa viene dopo il peso reale, provando i formati noti in ordine.
  function analizzaRestoRiga(resto) {
    let m;
    // Formato pieno: peso tassabile + trasporto + codice (es. "150   34,200i")
    if ((m = resto.match(/^\s*(\d{1,3})\s+([\d,\.]+)([a-zA-Z\*])/))) {
      return {
        pesoTass: parseFloat(m[1].replace(",", ".")),
        trasporto: parseFloat(m[2].replace(",", ".")),
        codiceTrasporto: m[3],
        senzaTrasporto: false,
        varieStart: resto.slice(resto.indexOf(m[3])),
      };
    }
    // Manca il tassabile, c'è solo trasporto + codice (es. "68,400Q")
    if ((m = resto.match(/^\s*([\d,\.]+)([a-zA-Z\*])/))) {
      return {
        pesoTass: null,
        trasporto: parseFloat(m[1].replace(",", ".")),
        codiceTrasporto: m[2],
        senzaTrasporto: false,
        varieStart: resto.slice(resto.indexOf(m[2])),
      };
    }
    // Manca il tassabile e non c'è nessun codice attaccato al trasporto (es. "20,000")
    if ((m = resto.match(/^\s*([\d,\.]+)(?=\s|$)/))) {
      return {
        pesoTass: null,
        trasporto: parseFloat(m[1].replace(",", ".")),
        codiceTrasporto: null,
        senzaTrasporto: false,
        varieStart: resto.slice(m[0].length),
      };
    }
    // Manca anche il trasporto: c'è subito un codice varie (reso/giacenza, es. "I")
    if ((m = resto.match(/^\s*([a-zA-Z])(?=\s|$)/))) {
      return {
        pesoTass: null,
        trasporto: 0,
        codiceTrasporto: m[1],
        senzaTrasporto: true,
        varieStart: resto,
      };
    }
    // Niente di riconoscibile: nessun trasporto, nessun codice, va comunque bene
    // come spedizione a sé — meglio dati mancanti che dati sbagliati.
    return { pesoTass: null, trasporto: 0, codiceTrasporto: null, senzaTrasporto: true, varieStart: resto };
  }

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
    } else if (current.senzaTrasporto && current.codiceTrasporto) {
      // riga "reso"/giacenza (vedi rowRe2): il codice subito dopo il peso reale
      // non è attaccato a un importo, va comunque mostrato come voce
      codici.unshift({ code: current.codiceTrasporto, label: LEGENDA_CODICI[current.codiceTrasporto] || current.codiceTrasporto, amount: null });
    }
    const pianoMatch = varieText.match(pianoRe) || current.anchorLine.match(pianoRe);
    rows.push({
      sped: current.sped,
      dataSpedizione: current.dataSpedizione || "",
      riferimento: current.riferimento || "",
      nominativo: current.nominativo.trim(),
      cap: current.cap,
      colli: current.colli,
      provinciaPartenza: current.provinciaPartenza,
      provinciaArrivo: current.provinciaArrivo,
      pesoReale: current.pesoReale,
      peso: current.pesoTass, // peso tassabile, tenuto solo come riferimento
      trasporto: current.trasporto,
      senzaTrasporto: !!current.senzaTrasporto,
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
    const m = line.match(rowStartRe);
    if (m) {
      closeCurrent(current);
      const [, sped, dataSpedRaw, riferimento, provinciaArrivo, provinciaPartenza, nominativo, cap, colli, , pesoReale] = m;
      // La fattura BRT scrive la data di partenza come ddmm (es. "0107" = 1 luglio),
      // senza anno: usiamo l'anno della fattura stessa per ricostruire la data completa.
      const dataSpedizione = dataSpedRaw && dataSpedRaw.length === 4
        ? `${dataSpedRaw.slice(0, 2)}/${dataSpedRaw.slice(2, 4)}`
        : "";
      const resto = line.slice(m.index + m[0].length);
      const info = analizzaRestoRiga(resto);
      current = {
        sped, dataSpedizione, riferimento: riferimento || "", provinciaPartenza, provinciaArrivo, nominativo, cap,
        colli: parseInt(colli, 10) || 1,
        codiceTrasporto: info.codiceTrasporto,
        pesoReale: parseFloat(pesoReale.replace(",", ".")),
        pesoTass: info.pesoTass != null ? info.pesoTass : parseFloat(pesoReale.replace(",", ".")), // se manca, usiamo il peso reale come riferimento
        trasporto: info.trasporto,
        senzaTrasporto: info.senzaTrasporto,
        anchorLine: line,
        varieLines: [info.varieStart],
        allLines: [line],
      };
      return;
    }
    if (current) {
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

