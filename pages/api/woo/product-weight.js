// pages/api/woo/product-weight.js
//
// Dato un product_id di WooCommerce, restituisce il peso reale del prodotto
// impostato nella scheda prodotto (campo "Peso" in WooCommerce, in kg).

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Metodo non permesso" });
  const { productId } = req.query;
  if (!productId) return res.status(400).json({ error: "Manca productId" });

  const { WC_URL, WC_KEY, WC_SECRET } = process.env;
  if (!WC_URL || !WC_KEY || !WC_SECRET) {
    return res.status(500).json({ error: "Chiavi WooCommerce non configurate su Vercel" });
  }

  try {
    const auth = Buffer.from(`${WC_KEY}:${WC_SECRET}`).toString("base64");
    const url = `${WC_URL.replace(/\/$/, "")}/wp-json/wc/v3/products/${productId}`;
    const wcRes = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
    if (!wcRes.ok) return res.status(wcRes.status).json({ error: "Prodotto non trovato" });
    const product = await wcRes.json();
    return res.status(200).json({
      nome: product.name,
      pesoKg: product.weight ? parseFloat(product.weight) : null,
      sku: product.sku,
    });
  } catch (err) {
    return res.status(500).json({ error: "Errore imprevisto", details: String(err) });
  }
}
