// pages/api/invoices/[id].js
import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  const { id } = req.query;

  if (req.method === "DELETE") {
    const invoices = (await kv.get("invoices")) || [];
    const filtered = invoices.filter((i) => i.id !== id);
    await kv.set("invoices", filtered);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: "Metodo non permesso" });
}
