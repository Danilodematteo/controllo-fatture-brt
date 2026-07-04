// pages/api/resolved.js
import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  if (req.method === "GET") {
    const resolved = (await kv.get("resolved")) || {};
    return res.status(200).json({ resolved });
  }
  if (req.method === "POST") {
    const { key, value } = req.body || {};
    if (!key) return res.status(400).json({ error: "Manca la chiave" });
    const resolved = (await kv.get("resolved")) || {};
    resolved[key] = value;
    await kv.set("resolved", resolved);
    return res.status(200).json({ ok: true });
  }
  return res.status(405).json({ error: "Metodo non permesso" });
}
