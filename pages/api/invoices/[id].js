// pages/api/invoices/[id].js
import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  const { id } = req.query;

  if (req.method === "DELETE") {
    const invoices = (await kv.get("invoices")) || [];
    const filtered = invoices.filter((i) => i.id !== id);
    await kv.set("invoices", filtered);
    await kv.del(`pdf:${id}`);
    return res.status(200).json({ ok: true });
  }

  if (req.method === "PUT") {
    const { rows } = req.body || {};
    if (!rows) return res.status(400).json({ error: "Mancano le righe aggiornate" });
    const invoices = (await kv.get("invoices")) || [];
    const idx = invoices.findIndex((i) => i.id === id);
    if (idx === -1) return res.status(404).json({ error: "Fattura non trovata" });
    invoices[idx].rows = rows;
    await kv.set("invoices", invoices);
    return res.status(200).json({ ok: true, invoice: invoices[idx] });
  }

  return res.status(405).json({ error: "Metodo non permesso" });
}
