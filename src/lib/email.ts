import nodemailer, { type Transporter } from "nodemailer";
import { env } from "./env";

let transport: Transporter | null | undefined;

function getTransport(): Transporter | null {
  if (transport === undefined) {
    const url = env().SMTP_URL;
    transport = url ? nodemailer.createTransport(url) : null;
  }
  return transport;
}

/** Sends an email, or logs it to the server console when SMTP isn't configured (dev). */
export async function sendEmail(opts: { to: string; subject: string; text: string; html?: string }) {
  const t = getTransport();
  if (!t) {
    console.info(`\n[email:dev] To: ${opts.to}\nSubject: ${opts.subject}\n${opts.text}\n`);
    return;
  }
  await t.sendMail({ from: env().EMAIL_FROM, ...opts });
}

export function actionEmail(heading: string, body: string, url: string, cta: string) {
  const text = `${heading}\n\n${body}\n\n${cta}: ${url}\n\nIf you didn't request this, you can ignore this email.`;
  const html = `<div style="font-family:system-ui,sans-serif;color:#1b1e24;max-width:480px;margin:auto;padding:24px">
  <p style="margin:0 0 16px;font-family:Georgia,serif;font-size:20px;font-weight:600;color:#1f241c">jobiza <span style="color:#d9d3c2">|</span> <span lang="ar" dir="rtl" style="color:#b8467a;font-size:15px">خُبَّيْزَة</span></p><h2 style="margin:0 0 12px">${heading}</h2><p style="color:#444">${body}</p>
  <p><a href="${url}" style="display:inline-block;background:#21402c;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">${cta}</a></p>
  <p style="color:#888;font-size:12px">If you didn't request this, you can ignore this email.</p></div>`;
  return { text, html };
}
