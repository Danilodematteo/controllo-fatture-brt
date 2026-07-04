// pages/api/woo/find-order.js
//
// Riceve: nominativo (nome e cognome dalla fattura BRT) + una data indicativa
// Cerca l'ordine WooCommerce corrispondente e restituisce i prodotti acquistati
// con il loro peso reale (dal listino De Matteo Home), così si può confrontare
// col peso dichiarato da BRT in fattura.
//
// Le chiavi WooCommerce NON vanno mai scritte qui nel codice: si leggono
// dalle variabili d'ambiente configurate su Vercel (Andrea le imposta lì).
//
// Variabili d'ambiente richieste:
//   WC_URL      -> es. https://dematteohome.it
//   WC_KEY      -> Consumer Key generata da WooCommerce (permesso: sola lettura)
//   WC_SECRET   -> Consumer Secret generata da WooCommerce

const { matchProduct } = require("../../../lib/matchProduct");

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Metodo non permesso" });

  const { nominativo, dataSpedizione } = req.body || {};
  if (!nominativo) return res.status(400).json({ error: "Manca il nominativo da cercare" });

  const { WC_URL, WC_KEY, WC_SECRET } = process.env;
  if (!WC_URL || !WC_KEY || !WC_SECRET) {
    return res.status(500).json({ error: "Chiavi WooCommerce non configurate su Vercel (WC_URL / WC_KEY / WC_SECRET)" });
  }

  try {
    // Finestra di ricerca: qualche giorno prima della data spedizione,
    // perché l'ordine viene fatto prima che BRT lo ritiri e fatturi.
    const params = new URLSearchParams({
      search: nominativo,
      per_page: "10",
      orderby: "date",
      order: "desc",
    });
    if (dataSpedizione) {
      const d = new Date(dataSpedizione);
      const after = new Date(d);
      after.setDate(after.getDate() - 20); // finestra ampia: 20 giorni prima
      params.set("after", after.toISOString());
      const before = new Date(d);
      before.setDate(before.getDate() + 2);
      params.set("before", before.toISOString());
    }

    const auth = Buffer.from(`${WC_KEY}:${WC_SECRET}`).toString("base64");
    const url = `${WC_URL.replace(/\/$/, "")}/wp-json/wc/v3/orders?${params.toString()}`;
    const wcRes = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });

    if (!wcRes.ok) {
      const text = await wcRes.text();
      return res.status(wcRes.status).json({ error: "Errore chiamata WooCommerce", details: text });
    }

    const orders = await wcRes.json();

    // Filtro lato server: il "search" di WooCommerce è ampio, restringiamo
    // controllando che nome+cognome fatturazione combacino ragionevolmente.
    const nomeLower = nominativo.toLowerCase();
    const candidati = orders.filter((o) => {
      const full = `${o.billing?.first_name || ""} ${o.billing?.last_name || ""}`.toLowerCase();
      return full.includes(nomeLower.split(" ")[0]) || nomeLower.includes(full.trim());
    });

    const risultati = (candidati.length ? candidati : orders).map((o) => ({
      orderId: o.id,
      orderNumber: o.number,
      data: o.date_created,
      cliente: `${o.billing?.first_name || ""} ${o.billing?.last_name || ""}`.trim(),
      prodotti: (o.line_items || []).map((li) => {
        const match = matchProduct(li.name);
        return {
          nome: li.name,
          quantita: li.quantity,
          pesoReale: match ? match.peso : null,
          prodottoListino: match ? match.descrizione : null,
          pesoTrovato: !!match,
        };
      }),
    }));

    // Il peso di ogni prodotto viene cercato nel listino De Matteo Home
    // (lib/data/pesoProdotti.json) confrontando nome e dimensione, dato che
    // WooCommerce non ha il peso compilato nelle schede prodotto.
    // Se un prodotto non viene trovato (pesoTrovato: false), pesoReale è null
    // e va controllato/aggiunto a mano nel listino.

    return res.status(200).json({ risultati });
  } catch (err) {
    return res.status(500).json({ error: "Errore imprevisto", details: String(err) });
  }
}
