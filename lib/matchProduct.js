// lib/matchProduct.js
//
// Confronta il nome prodotto come appare nell'ordine WooCommerce
// (es. "Materasso New Memo Molle - Matrimoniale, Misura - 160 x 190 - Matrimoniale + Omaggi")
// con le righe del listino De Matteo Home (es. "MATERASSO NEW MEMO MOLLE 160x190 + CUSCINI FIOCCO")
// per trovare il peso reale del prodotto, anche se scritti in modo diverso.

const listino = require("./data/pesoProdotti.json");

// Parole generiche da ignorare nel confronto (misure, congiunzioni, ecc.)
// Non riguardano la linea/modello del prodotto, solo taglia/formato.
const FILLER = new Set([
  "MATERASSO", "MISURA", "MATRIMONIALE", "SINGOLO", "SINGOLA", "QUEEN", "KING",
  "DOPPIO", "DOPPIA", "PIAZZA", "MEZZA", "FRANCESE", "OMAGGI", "OMAGGIO",
  "CUSCINI", "CUSCINO", "FIOCCO", "PER", "DI", "E", "CON", "IL", "LA", "UNA", "UN"
]);

function normalizeDim(s) {
  if (!s) return null;
  const m = String(s).match(/(\d{2,3})\s*[x×]\s*(\d{2,3})/i);
  if (!m) return null;
  return `${m[1]}x${m[2]}`;
}

function coreWords(s) {
  if (!s) return [];
  return String(s)
    .toUpperCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // rimuove accenti
    .replace(/[^A-Z0-9\s]/g, " ") // rimuove punteggiatura (+, -, virgole...)
    .split(/\s+/)
    .filter((w) => w && !FILLER.has(w) && !/^\d+$/.test(w) && !/^\d+X\d+$/i.test(w));
}

/**
 * Trova la riga di listino più simile a un nome prodotto WooCommerce.
 * Richiede stessa dimensione (se rilevabile) + almeno una parola chiave in comune.
 * Ritorna null se non trova nulla di sufficientemente simile (meglio non
 * indovinare un peso sbagliato che darne uno a caso).
 */
function matchProduct(nomeWoo) {
  const dim = normalizeDim(nomeWoo);
  const words = new Set(coreWords(nomeWoo));
  let best = null;
  let bestScore = 0;

  for (const item of listino) {
    const itemDim = normalizeDim(item.descrizione);
    if (dim && itemDim && dim !== itemDim) continue; // dimensione diversa, scarta
    if (!item.peso) continue; // riga senza peso utile, scarta

    const itemWords = coreWords(item.descrizione);
    const overlap = itemWords.filter((w) => words.has(w)).length;
    if (overlap > bestScore) {
      bestScore = overlap;
      best = item;
    }
  }

  if (bestScore === 0) return null;
  return { ...best, confidenza: bestScore };
}

module.exports = { matchProduct, normalizeDim, coreWords };
