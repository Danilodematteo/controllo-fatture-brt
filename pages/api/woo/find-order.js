// pages/api/woo/find-order.js
//
// Riceve il "riferimento mittente" che BRT scrive in fattura (spesso
// identico al numero ordine WooCommerce, es. riferimento 109451 = ordine
// #109451) e cerca SOLO con quello: chiamata diretta a /orders/<riferimento>.
//
// NIENTE fallback per nome/CAP: la ricerca per nome può abboccare
// all'ordine sbagliato quando ci sono clienti omonimi o nomi simili
// (è successo — es. spedizione SANGUINETTI A abbinata a un peso
// completamente sballato). Meglio nessun risultato che un risultato
// sbagliato: se il riferimento manca, è troppo corto o l'ordine non
// esiste, si ritorna "nessun risultato" e basta.
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

function formattaOrdine(o, listino) {
  return {
    orderId: o.id,
    orderNumber: o.number,
    data: o.date_created,
    cliente: `${o.billing?.first_name || ""} ${o.billing?.last_name || ""}`.trim(),
    trovatoPer: "riferimento mittente",
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

  const { riferimento } = req.body || {};

  // Riferimenti troppo corti (es. "1") sono quasi certamente un valore
  // segnaposto, non un vero numero ordine: non proviamo nemmeno.
  if (!riferimento || riferimento.length < 4) {
    return res.status(200).json({ risultati: [], motivo: "Riferimento mittente mancante o troppo corto" });
  }

  const { WC_URL, WC_KEY, WC_SECRET } = process.env;
  if (!WC_URL || !WC_KEY || !WC_SECRET) {
    return res.status(500).json({ error: "Chiavi WooCommerce non configurate su Vercel (WC_URL / WC_KEY / WC_SECRET)" });
  }

  const auth = Buffer.from(`${WC_KEY}:${WC_SECRET}`).toString("base64");
  const base = WC_URL.replace(/\/$/, "");

  try {
    const listino = await getListino();
    const dirRes = await fetch(`${base}/wp-json/wc/v3/orders/${riferimento}`, { headers: { Authorization: `Basic ${auth}` } });
    if (dirRes.ok) {
      const o = await dirRes.json();
      if (o && o.id) {
        return res.status(200).json({ risultati: [formattaOrdine(o, listino)] });
      }
    }
    return res.status(200).json({ risultati: [], motivo: `Nessun ordine WooCommerce con numero ${riferimento}` });
  } catch (err) {
    return res.status(500).json({ error: "Errore imprevisto", details: String(err) });
  }
}
