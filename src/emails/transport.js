// Sends an email, or (EMAIL_TRANSPORT=log) just records it.
import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";

// The most recent "sent" emails in log mode, newest last (tests read this)
export const sentEmails = [];

// Where log mode saves emails as .html files (outside tests). Git ignores this folder.
const OUTBOX_DIR = path.join(import.meta.dirname, "../../.emails");

const saveToOutbox = async (email) => {
  await fs.mkdir(OUTBOX_DIR, { recursive: true });
  const safeSubject = email.subject.replace(/[^a-z0-9]+/gi, "-").slice(0, 60);
  const file = path.join(OUTBOX_DIR, `${new Date().toISOString().replace(/[:.]/g, "-")}-${safeSubject}.html`);
  await fs.writeFile(file, `<!-- To: ${email.to} | Subject: ${email.subject} -->\n${email.html}`);
  return file;
};

const sendWithBrevo = async (email) => {
  // Docs: https://developers.brevo.com/reference/sendtransacemail
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": env.BREVO_API_KEY, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { name: env.EMAIL_FROM_NAME, email: env.EMAIL_FROM_ADDRESS },
      to: [{ email: email.to, ...(email.toName && { name: email.toName }) }],
      subject: email.subject,
      htmlContent: email.html,
      textContent: email.text
    }),
    signal: AbortSignal.timeout(10_000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Brevo send failed (${response.status}): ${body.message ?? "unknown error"}`);
  }
  return body.messageId;
};

// With EMAIL_REDIRECT_TO set, the email goes to that address instead (nobody real is emailed
// by mistake from a test system, and made-up demo addresses don't bounce)
const applyRedirect = (email) =>
  env.EMAIL_REDIRECT_TO
    ? { ...email, to: env.EMAIL_REDIRECT_TO, toName: undefined, subject: `[to ${email.to}] ${email.subject}` }
    : email;

// email: { to, toName?, subject, html, text }. Throws on failure, so the queue retries it.
export const sendEmail = async (original) => {
  const email = applyRedirect(original);

  if (env.EMAIL_TRANSPORT === "brevo") {
    const messageId = await sendWithBrevo(email);
    logger.info({ to: email.to, subject: email.subject, messageId }, "Email sent");
    return;
  }

  sentEmails.push(email);
  if (sentEmails.length > 100) {
    sentEmails.shift();
  }
  const file = env.NODE_ENV === "test" ? undefined : await saveToOutbox(email);
  logger.info({ to: email.to, subject: email.subject, file }, "Email (log mode, not sent)");
};
