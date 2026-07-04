// lib/pesoStore.js
//
// Il listino pesi vive nel database (Vercel KV), così può essere modificato
// dall'interfaccia dell'app senza dover toccare il codice. La prima volta
// che viene richiesto, si "semina" a partire dal file lib/data/pesoProdotti.json
// (il listino Marea Sistemi convertito). Da lì in poi vive nel database.

const { kv } = require("@vercel/kv");
const seed = require("./data/pesoProdotti.json");

async function getListino() {
  let list = await kv.get("pesoProdotti");
  if (!list || !list.length) {
    list = seed;
    await kv.set("pesoProdotti", list);
  }
  return list;
}

async function saveListino(list) {
  await kv.set("pesoProdotti", list);
}

/**
 * Aggiunge o aggiorna un prodotto nel listino.
 * Se esiste già un prodotto con lo stesso codice (o, in mancanza, stessa
 * descrizione esatta), lo aggiorna. Altrimenti lo aggiunge come nuovo.
 */
async function upsertProdotto(item) {
  const list = await getListino();
  let idx = -1;
  if (item.codice) idx = list.findIndex((p) => p.codice === item.codice);
  if (idx === -1 && item.descrizione) {
    idx = list.findIndex((p) => p.descrizione.toUpperCase() === item.descrizione.toUpperCase());
  }
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...item };
  } else {
    list.push({
      codice: item.codice || "",
      descrizione: item.descrizione,
      categoria: item.categoria || "",
      peso: item.peso,
    });
  }
  await saveListino(list);
  return list;
}

async function eliminaProdotto(codice, descrizione) {
  const list = await getListino();
  const filtered = list.filter((p) => !(p.codice === codice && p.descrizione === descrizione));
  await saveListino(filtered);
  return filtered;
}

module.exports = { getListino, saveListino, upsertProdotto, eliminaProdotto };
