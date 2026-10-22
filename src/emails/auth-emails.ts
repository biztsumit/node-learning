// Emails with one-time links: reset your password, verify your email address.
import { env } from "../config/env.ts";
import { TOKEN_LIFETIME_MINUTES, type TokenPurpose } from "../services/auth-token.services.ts";
import type { Email } from "./transport.ts";
import { escapeHtml } from "./order-emails.ts";

// The page that handles each link. APP_URL is your frontend; in development it defaults to
// the small tool pages this API serves (/tools/reset-password, /tools/verify-email).
const LINKS: Record<TokenPurpose, (token: string) => string> = {
  password_reset: (token) => `${env.APP_URL}/reset-password?token=${encodeURIComponent(token)}`,
  email_verification: (token) => `${env.APP_URL}/verify-email?token=${encodeURIComponent(token)}`
};

type AuthEmailContent = { subject: string; heading: string; intro: string; button: string; outro: (minutes: number) => string };

// Record<TokenPurpose, ...>: a new kind of link can't be added without its email
const CONTENT: Record<TokenPurpose, AuthEmailContent> = {
  password_reset: {
    subject: "Reset your password",
    heading: "Reset your password",
    intro: "Someone (hopefully you) asked to reset the password for your account.",
    button: "Choose a new password",
    outro: (minutes) => `This link works once and expires in ${minutes} minutes. If you didn't ask for this, you can ignore this email: your password won't change.`
  },
  email_verification: {
    subject: "Please confirm your email address",
    heading: "Confirm your email",
    intro: "Thanks for signing up! Please confirm this is your email address.",
    button: "Confirm my email",
    outro: (minutes) => `This link works once and expires in ${minutes / 60} hours.`
  }
};

export const AUTH_EMAIL_TYPES = Object.keys(CONTENT) as TokenPurpose[];

// user: { name, email }. Builds { to, toName, subject, html, text }.
export const buildAuthEmail = (type: TokenPurpose, user: { name: string; email: string }, token: string): Email => {
  const content = CONTENT[type];
  if (!content) {
    throw new Error(`Unknown auth email type "${type}"`);
  }
  const link = LINKS[type](token);
  const outro = content.outro(TOKEN_LIFETIME_MINUTES[type]);

  const html = `<!doctype html>
<html><body style="margin:0;background:#f5f5f5;font-family:Arial,sans-serif;color:#222">
  <div style="max-width:560px;margin:24px auto;background:#fff;border-radius:8px;padding:24px">
    <p style="color:#888;font-size:13px;margin:0 0 8px">${escapeHtml(env.EMAIL_FROM_NAME)}</p>
    <h1 style="font-size:22px;margin:0 0 16px">${content.heading}</h1>
    <p>Hi ${escapeHtml(user.name)},</p>
    <p>${content.intro}</p>
    <p style="margin:24px 0">
      <a href="${escapeHtml(link)}" style="background:#2563eb;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block">${content.button}</a>
    </p>
    <p style="font-size:13px;color:#555">Or copy this link into your browser:<br><span style="word-break:break-all">${escapeHtml(link)}</span></p>
    <p style="font-size:13px;color:#555">${outro}</p>
  </div>
</body></html>`;

  const text = [`Hi ${user.name},`, "", content.intro, "", `${content.button}: ${link}`, "", outro].join("\n");

  return { to: user.email, toName: user.name, subject: content.subject, html, text };
};
