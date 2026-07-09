// pages/api/invoices/[id]/pdf.js
//
// Conserva il PDF originale della fattura BRT, separato dalla lista
// "invoices" (che resta leggera per il caricamento dell'archivio).
// Chiave KV: pdf:<id> -> stringa base64 del PDF.
//
// Serve per poter fare un controllo "testa/croce" direttamente
// dall'app, senza dover andare a recuperare la mail su Roundcube.

import { kv } from "@vercel/kv";

export const config = {
  api: { bodyParser: { sizeLimit: "15mb" } },
};

export default async function handler(req, res) {
  const { id } = req.query;

  if (req.method === "POST") {
    const { pdfBase64 } = req.body || {};
    if (!pdfBase64) return res.status(400).json({ error: "Manca il PDF (pdfBase64)" });
    await kv.set(`pdf:${id}`, pdfBase64);
    return res.status(200).json({ ok: true });
  }

  if (req.method === "GET") {
    const pdfBase64 = await kv.get(`pdf:${id}`);
    if (!pdfBase64) return res.status(404).json({ error: "PDF non trovato per questa fattura" });
    const buffer = Buffer.from(pdfBase64, "base64");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="fattura-${id}.pdf"`);
    return res.status(200).send(buffer);
  }

  if (req.method === "DELETE") {
    await kv.del(`pdf:${id}`);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: "Metodo non permesso" });
}
