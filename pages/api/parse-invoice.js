// pages/api/parse-invoice.js
//
// Riceve il PDF della fattura BRT caricato da Anna, lo legge lato server
// (più affidabile del PDF.js nel browser) e restituisce righe già pronte.

import { extractHeader, parseInvoiceText } from "../../lib/parseInvoice";

export const config = {
  api: { bodyParser: false },
};

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Metodo non permesso" });

  try {
    const pdfParse = require("pdf-parse");
    const buffer = await readRawBody(req);
    const data = await pdfParse(buffer);
    const header = extractHeader(data.text);
    const { rows, unparsed } = parseInvoiceText(data.text);
    return res.status(200).json({ header, rows, unparsed });
  } catch (err) {
    return res.status(500).json({ error: "Errore lettura PDF", details: String(err) });
  }
}
