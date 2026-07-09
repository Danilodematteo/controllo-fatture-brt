// pages/api/woo/find-order.js
//
// Riceve: nominativo, CAP, data spedizione e (quando c'è) "riferimento" —
// il numero che BRT chiama "riferimento mittente" in fattura.
//
// SCOPERTA IMPORTANTE: quel numero spesso corrisponde esattamente al numero
// dell'ordine WooCommerce (es. riferimento 109451 = ordine #109451). Quando
// è così, l'ordine si trova al 100% con una sola chiamata diretta, senza
// bisogno di indovinare dal nome. Se il riferimento è troppo corto (es. "1",
// un valore segnaposto) o la chiamata diretta non trova nulla, si ricade
// sulla ricerca per nome + CAP come prima.
//
// Le chiavi WooCommerce NON vanno mai scritte qui nel codice: si leggono
// dalle variabili d'ambiente configurate su Vercel (Andrea le imposta lì).
//
// Variabili d'ambiente richieste:
//   WC_URL      -> es. https://dematteohome.it
//   WC_KEY      -> Consumer Key generata da WooCommerce (permesso: sola lettura)
//   WC_SECRET   -> Consumer Secret generata da WooCommerce

const { matchProduct } = require("../../../lib/matchProduct");
const { getListino } = require("../../../lib/pesoStore");

function normalizza(s) {
  return (s || "")
    .toString()
    .toUpperCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z\s]/g, " ")
    .trim();
}

function somiglianzaNomi(cercato, trovato) {
  const parole1 = normalizza(cercato).split(/\s+/).filter(Boolean);
  const parole2 = normalizza(trovato).split(/\s+/).filter(Boolean);
  if (!parole1.length || !parole2.length) return 0;
  let match = 0;
  parole1.forEach((p1) => {
    if (parole2.some((p2) => p2.startsWith(p1) || p1.startsWith(p2))) match++;
  });
  return match / parole1.length;
}

function formattaOrdine(o, listino, extra) {
  return {
    orderId: o.id,
    orderNumber: o.number,
    data: o.date_created,
    cliente: `${o.billing?.first_name || ""} ${o.billing?.last_name || ""}`.trim(),
    trovatoPer: extra?.trovatoPer || "nome",
    capCombacia: extra?.capCombacia || false,
    somiglianzaNome: extra?.somiglianzaNome ?? null,
    prodotti: (o.line_items || []).map((li) => {
      const match = matchProduct(li.name, listino);
      return {
        nome: li.name,
        quantita: li.quantity,
        pesoReale: match ? match.peso : null,
        prodottoListino: match ? match.descrizione : null,
        pesoTrovato: !!match,
      };
    }),
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Metodo non permesso" });

  const { nominativo, dataSpedizione, cap, riferimento } = req.body || {};
  if (!nominativo) return res.status(400).json({ error: "Manca il nominativo da cercare" });

  const { WC_URL, WC_KEY, WC_SECRET } = process.env;
  if (!WC_URL || !WC_KEY || !WC_SECRET) {
    return res.status(500).json({ error: "Chiavi WooCommerce non configurate su Vercel (WC_URL / WC_KEY / WC_SECRET)" });
  }

  const auth = Buffer.from(`${WC_KEY}:${WC_SECRET}`).toString("base64");
  const base = WC_URL.replace(/\/$/, "");

  try {
    const listino = await getListino();

    // --- Tentativo 1: numero ordine esatto (riferimento mittente) ---
    // Scartiamo riferimenti troppo corti (es. "1"), quasi certamente non un vero numero ordine.
    if (riferimento && riferimento.length >= 4) {
      const dirRes = await fetch(`${base}/wp-json/wc/v3/orders/${riferimento}`, { headers: { Authorization: `Basic ${auth}` } });
      if (dirRes.ok) {
        const o = await dirRes.json();
        if (o && o.id) {
          return res.status(200).json({ risultati: [formattaOrdine(o, listino, { trovatoPer: "numero ordine" })] });
        }
      }
    }

    // --- Tentativo 2: ricerca per nome, finestra 60 giorni, conferma con CAP ---
    const params = new URLSearchParams({ search: nominativo, per_page: "20", orderby: "date", order: "desc" });
    if (dataSpedizione) {
      const d = new Date(dataSpedizione);
      const after = new Date(d); after.setDate(after.getDate() - 60);
      params.set("after", after.toISOString());
      const before = new Date(d); before.setDate(before.getDate() + 3);
      params.set("before", before.toISOString());
    }
    const url = `${base}/wp-json/wc/v3/orders?${params.toString()}`;
    const wcRes = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
    if (!wcRes.ok) {
      const text = await wcRes.text();
      return res.status(wcRes.status).json({ error: "Errore chiamata WooCommerce", details: text });
    }
    const orders = await wcRes.json();

    const capCercato = (cap || "").trim();
    const candidati = orders.map((o) => {
      const nomeCompleto = `${o.billing?.first_name || ""} ${o.billing?.last_name || ""}`.trim();
      const capOrdine = o.billing?.postcode || o.shipping?.postcode || "";
      const somiglianza = somiglianzaNomi(nominativo, nomeCompleto);
      const capCombacia = capCercato && capOrdine && capOrdine.trim() === capCercato;
      let punteggio = somiglianza;
      if (capCombacia) punteggio += 1;
      return { order: o, somiglianza, capCombacia, punteggio };
    }).filter((c) => c.somiglianza > 0 || c.capCombacia);

    candidati.sort((a, b) => b.punteggio - a.punteggio);
    const scelto = candidati[0];

    if (!scelto) return res.status(200).json({ risultati: [] });

    return res.status(200).json({
      risultati: [formattaOrdine(scelto.order, listino, {
        trovatoPer: "nome" + (scelto.capCombacia ? " + CAP" : ""),
        capCombacia: scelto.capCombacia,
        somiglianzaNome: Math.round(scelto.somiglianza * 100),
      })],
    });
  } catch (err) {
    return res.status(500).json({ error: "Errore imprevisto", details: String(err) });
  }
}
