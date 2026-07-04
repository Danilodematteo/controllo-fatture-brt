// pages/api/invoices/index.js
//
// Sostituisce il "window.storage" di Claude con un vero database
// (Vercel KV, gratuito nei piani base). Andrea deve solo collegare
// un database KV al progetto da Vercel Dashboard -> Storage -> KV,
// che imposta da solo le variabili d'ambiente KV_* necessarie.

import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  if (req.method === "GET") {
    const invoices = (await kv.get("invoices")) || [];
    return res.status(200).json({ invoices });
  }

  if (req.method === "POST") {
    const invoice = req.body;
    if (!invoice || !invoice.numero || !invoice.data) {
      return res.status(400).json({ error: "Fattura non valida (manca numero o data)" });
    }
    const invoices = (await kv.get("invoices")) || [];
    invoice.id = invoice.id || "inv" + Date.now();
    invoices.push(invoice);
    await kv.set("invoices", invoices);
    return res.status(200).json({ ok: true, invoice });
  }

  return res.status(405).json({ error: "Metodo non permesso" });
}
