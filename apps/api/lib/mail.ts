import nodemailer from "nodemailer";

import { onVercel } from "./env";

/**
 * The one email seam: nodemailer over a Gmail app password, the same setup
 * ts-platform uses (EMAIL_USER, EMAIL_PASS, optional EMAIL_FROM and
 * EMAIL_SERVICE). On a laptop with no mail keys, the message is printed to
 * the API terminal instead, so sign-in still works offline.
 */
export type Mail = { to: string; subject: string; html: string; text: string };

let transport: ReturnType<typeof nodemailer.createTransport> | null = null;

export async function sendMail(mail: Mail): Promise<"sent" | "printed"> {
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;
  if (!user || !pass) {
    if (onVercel()) throw new Error("Email is not configured (EMAIL_USER, EMAIL_PASS).");
    console.log(`\n[mail] No EMAIL_USER/EMAIL_PASS; printing instead.\n  To: ${mail.to}\n  Subject: ${mail.subject}\n${mail.text}\n`);
    return "printed";
  }
  transport ??= nodemailer.createTransport({ service: process.env.EMAIL_SERVICE ?? "gmail", auth: { user, pass } });
  await transport.sendMail({ from: process.env.EMAIL_FROM ?? `"Strategic Machines" <${user}>`, ...mail });
  return "sent";
}

// ── The one email layout (sign-in, invites, …) ───────────────────────────────
const LOGO = "https://res.cloudinary.com/stratmachine/image/upload/w_96,h_96,c_fit,f_png/v1592332363/machine/icon-512x512_zaffp5.png";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A branded message: heading, a few plain lines, one button, a quiet footer. Text is escaped. */
export function emailLayout(m: { heading: string; lines: string[]; button: { label: string; href: string }; footer: string }) {
  const html = `<!doctype html><html><body style="margin:0;background:#f4f4f6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#17171c">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 16px">
<table role="presentation" width="100%" style="max-width:480px;background:#ffffff;border-radius:16px;padding:36px">
<tr><td><img src="${LOGO}" width="40" height="40" alt="Strategic Machines" style="border-radius:10px"></td></tr>
<tr><td style="padding-top:24px;font-size:22px;font-weight:600">${esc(m.heading)}</td></tr>
${m.lines.map((l) => `<tr><td style="padding-top:8px;font-size:15px;line-height:1.5;color:#55555f">${esc(l)}</td></tr>`).join("\n")}
<tr><td style="padding-top:28px"><a href="${esc(m.button.href)}" style="display:inline-block;background:#c9a227;color:#17140a;font-weight:600;font-size:15px;text-decoration:none;padding:12px 22px;border-radius:10px">${esc(m.button.label)}</a></td></tr>
<tr><td style="padding-top:28px;font-size:13px;line-height:1.5;color:#8a8a94">${esc(m.footer)}<br>Strategic Machines · The AI Control Room for your website</td></tr>
</table></td></tr></table></body></html>`;
  const text = `${m.heading}\n\n${m.lines.join("\n")}\n\n${m.button.label}: ${m.button.href}\n\n${m.footer}`;
  return { html, text };
}
