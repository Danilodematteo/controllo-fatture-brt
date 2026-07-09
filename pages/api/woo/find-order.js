// pages/api/woo/find-order.js
//
// Riceve: nominativo (nome e cognome dalla fattura BRT) + CAP + una data
// indicativa. Cerca l'ordine WooCommerce corrispondente e restituisce i
// prodotti acquistati con il loro peso reale (dal listino De Matteo Home),
// così si può confrontare col peso dichiarato da BRT in fattura.
//
// Il nome in fattura BRT è spesso troncato (es. "PACIELLO MARC" invece di
// "Marco Paciello"): il confronto quindi non richiede match esatto, e usa
// il CAP come conferma quando il nome combacia solo in parte.
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
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // rimuove accenti
    .replace(/[^A-Z\s]/g, " ")
    .trim();
}

// Quanto due nomi si assomigliano: per ogni parola cercata, controlla se è
// prefisso/sottostringa di una parola del nome trovato (gestisce i troncamenti
// tipo "MARC" per "MARCO") e viceversa.
function somiglianzaNomi(cercato, trovato) {
  const parole1 = normalizza(cercato).split(/\s+/).filter(Boolean);
  const parole2 = normalizza(trovato).split(/\s+/).filter(Boolean);
  if (!parole1.length || !parole2.length) return 0;
  let match = 0;
  parole1.forEach((p1) => {
    if (parole2.some((p2) => p2.startsWith(p1) || p1.startsWith(p2))) match++;
  });
  return match / parole1.length; // 0..1
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Metodo non permesso" });

  const { nominativo, dataSpedizione, cap } = req.body || {};
  if (!nominativo) return res.status(400).json({ error: "Manca il nominativo da cercare" });

  const { WC_URL, WC_KEY, WC_SECRET } = process.env;
  if (!WC_URL || !WC_KEY || !WC_SECRET) {
    return res.status(500).json({ error: "Chiavi WooCommerce non configurate su Vercel (WC_URL / WC_KEY / WC_SECRET)" });
  }

  try {
    // Finestra di ricerca: fino a 60 giorni prima della data spedizione,
    // perché l'ordine viene fatto prima che BRT lo ritiri e fatturi.
    const params = new URLSearchParams({
      search: nominativo,
      per_page: "20",
      orderby: "date",
      order: "desc",
    });
    if (dataSpedizione) {
      const d = new Date(dataSpedizione);
      const after = new Date(d);
      after.setDate(after.getDate() - 60);
      params.set("after", after.toISOString());
      const before = new Date(d);
      before.setDate(before.getDate() + 3);
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
    const listino = await getListino();

    // Punteggio per ogni ordine trovato: somiglianza del nome (0-1) + bonus
    // se il CAP di fatturazione o spedizione combacia esattamente (conferma
    // forte quando il nome è troncato o scritto diverso).
    const capCercato = (cap || "").trim();
    const candidatiConPunteggio = orders.map((o) => {
      const nomeCompleto = `${o.billing?.first_name || ""} ${o.billing?.last_name || ""}`.trim();
      const capOrdine = o.billing?.postcode || o.shipping?.postcode || "";
      const somiglianza = somiglianzaNomi(nominativo, nomeCompleto);
      const capCombacia = capCercato && capOrdine && capOrdine.trim() === capCercato;
      let punteggio = somiglianza;
      if (capCombacia) punteggio += 1; // il CAP che combacia pesa più del nome
      return { order: o, nomeCompleto, capOrdine, somiglianza, capCombacia, punteggio };
    }).filter((c) => c.somiglianza > 0 || c.capCombacia);

    candidatiConPunteggio.sort((a, b) => b.punteggio - a.punteggio);
    const scelti = candidatiConPunteggio.length ? [candidatiConPunteggio[0].order] : orders;

    const risultati = scelti.map((o) => {
      const info = candidatiConPunteggio.find((c) => c.order.id === o.id);
      return {
        orderId: o.id,
        orderNumber: o.number,
        data: o.date_created,
        cliente: `${o.billing?.first_name || ""} ${o.billing?.last_name || ""}`.trim(),
        capCombacia: info ? info.capCombacia : false,
        somiglianzaNome: info ? Math.round(info.somiglianza * 100) : null,
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
    });

    return res.status(200).json({ risultati });
  } catch (err) {
    return res.status(500).json({ error: "Errore imprevisto", details: String(err) });
  }
}
