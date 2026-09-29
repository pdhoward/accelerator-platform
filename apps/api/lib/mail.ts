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
