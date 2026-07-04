// pages/api/tariffario.js
import { kv } from "@vercel/kv";
import { DEFAULT_TARIFF } from "../../lib/tariff";

export default async function handler(req, res) {
  if (req.method === "GET") {
    const tariff = (await kv.get("tariffario")) || DEFAULT_TARIFF;
    return res.status(200).json({ tariff });
  }
  if (req.method === "POST") {
    const tariff = req.body;
    if (!tariff || !tariff.brackets) return res.status(400).json({ error: "Tariffario non valido" });
    await kv.set("tariffario", tariff);
    return res.status(200).json({ ok: true });
  }
  return res.status(405).json({ error: "Metodo non permesso" });
}
