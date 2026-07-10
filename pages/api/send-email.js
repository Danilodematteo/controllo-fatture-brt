// pages/api/send-email.js
//
// Invia direttamente la mail a Daniele (BRT) via SMTP, usando le credenziali
// configurate come variabili d'ambiente su Vercel — MAI scritte nel codice:
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
//
// Il destinatario resta fisso (Daniele di BRT), coerente con lo scopo
// dell'app: non è un tool di invio email generico.

import nodemailer from "nodemailer";

const DESTINATARIO = "daniele.derosa@brt.it";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Metodo non permesso" });

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    return res.status(500).json({
      error: "Invio diretto non configurato: mancano le variabili SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS su Vercel.",
    });
  }

  const { subject, body } = req.body || {};
  if (!subject || !body) return res.status(400).json({ error: "Manca oggetto o testo della mail" });

  try {
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: parseInt(SMTP_PORT, 10),
      secure: parseInt(SMTP_PORT, 10) === 465, // 465 = SSL diretto, 587 = STARTTLS
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });

    await transporter.sendMail({
      from: SMTP_USER,
      to: DESTINATARIO,
      subject,
      text: body,
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    // Non esporre dettagli sensibili (es. credenziali) nel messaggio d'errore al client
    return res.status(500).json({ error: "Invio fallito: " + (err?.message || "errore sconosciuto") });
  }
}
