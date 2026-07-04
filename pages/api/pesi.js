// pages/api/pesi.js
import { getListino, upsertProdotto, eliminaProdotto } from "../../lib/pesoStore";

export default async function handler(req, res) {
  if (req.method === "GET") {
    const listino = await getListino();
    return res.status(200).json({ listino });
  }
  if (req.method === "POST") {
    const item = req.body;
    if (!item || !item.descrizione || item.peso === undefined || item.peso === "") {
      return res.status(400).json({ error: "Servono almeno descrizione e peso" });
    }
    item.peso = parseFloat(String(item.peso).replace(",", "."));
    const listino = await upsertProdotto(item);
    return res.status(200).json({ ok: true, listino });
  }
  if (req.method === "DELETE") {
    const { codice, descrizione } = req.body || {};
    const listino = await eliminaProdotto(codice, descrizione);
    return res.status(200).json({ ok: true, listino });
  }
  return res.status(405).json({ error: "Metodo non permesso" });
}
