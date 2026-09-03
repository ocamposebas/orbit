import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import nodemailer from "nodemailer";
import { getServerEnv, validateSmtpConfiguration } from "@/sentinel/config";

export const EMAIL_LOGIN_CODE_TTL_MS = 10 * 60_000;
export const EMAIL_LOGIN_MAX_ATTEMPTS = 5;
export const EMAIL_LOGIN_MAX_SENDS = 3;

const escapeHtml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

export function createLoginEmailCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function loginEmailCodeHash(token: string, code: string) {
  return createHash("sha256").update(`orbit:login-email:${token}:${code}`).digest("hex");
}

export function verifyLoginEmailCode(token: string, code: string, expectedHash: string) {
  if (!/^\d{6}$/.test(code) || !/^[a-f0-9]{64}$/.test(expectedHash)) return false;
  return timingSafeEqual(Buffer.from(loginEmailCodeHash(token, code), "hex"), Buffer.from(expectedHash, "hex"));
}

export function maskLoginEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "your registered email";
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"•".repeat(Math.max(3, Math.min(8, local.length - visible.length)))}@${domain}`;
}

export function loginEmailDeliveryErrorCode(error: unknown) {
  const value = error as { code?: unknown; responseCode?: unknown };
  return String(value?.code ?? value?.responseCode ?? "SMTP_DELIVERY_FAILED").replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 80);
}

export function loginVerificationEmailHtml(input: { name?: string | null; code: string }) {
  const greeting = input.name?.trim() ? `Hello ${escapeHtml(input.name.trim())},` : "Hello,";
  const code = escapeHtml(input.code);
  return `<!doctype html><html><body style="margin:0;background:#f4f5f8;font-family:Arial,sans-serif;color:#11182f"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#fff;border:1px solid #e5e7eb;border-radius:18px;overflow:hidden"><tr><td style="height:7px;background:#6557d9"></td></tr><tr><td style="padding:38px 42px"><div style="font-size:20px;font-weight:700;letter-spacing:-.5px">ORBIT</div><div style="font-size:9px;color:#7b8190;letter-spacing:1.4px;margin-top:5px">SECURE SIGN-IN</div><h1 style="font-size:27px;line-height:1.2;margin:34px 0 12px">Confirm your sign-in</h1><p style="font-size:14px;line-height:1.7;color:#596172;margin:0">${greeting}<br>Use this one-time code to finish signing in to ORBIT.</p><div style="margin:28px 0;background:#f6f7fa;border:1px solid #eceef3;border-radius:12px;padding:22px;text-align:center;font-size:32px;font-weight:700;letter-spacing:10px;color:#29235c">${code}</div><p style="font-size:12px;line-height:1.7;color:#7b8190;margin:0">This code expires in 10 minutes and can be used once. If you did not request it, do not share the code and contact your ORBIT administrator.</p></td></tr><tr><td style="background:#11182f;color:#cdd2df;padding:24px 42px;font-size:11px;line-height:1.6"><strong style="color:#fff">ORBIT</strong><br>Account security · Never share verification codes.</td></tr></table></td></tr></table></body></html>`;
}

export async function sendLoginVerificationEmail(input: { recipient: string; name?: string | null; code: string }) {
  const env = getServerEnv();
  const smtp = validateSmtpConfiguration(env);
  if (!smtp.configured || !env.SMTP_HOST || !env.SMTP_USERNAME || !env.SMTP_PASSWORD || !env.SMTP_FROM_EMAIL) throw Object.assign(new Error("SMTP_NOT_CONFIGURED"), { code: "SMTP_NOT_CONFIGURED" });
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURITY === "tls",
    requireTLS: env.SMTP_SECURITY === "starttls",
    auth: { user: env.SMTP_USERNAME, pass: env.SMTP_PASSWORD },
    tls: { rejectUnauthorized: true },
  });
  const result = await transport.sendMail({
    from: { name: env.SMTP_FROM_NAME, address: env.SMTP_FROM_EMAIL },
    replyTo: env.SMTP_REPLY_TO,
    to: input.recipient,
    subject: "Your ORBIT sign-in code",
    html: loginVerificationEmailHtml(input),
    text: `Your ORBIT sign-in code is ${input.code}. It expires in 10 minutes and can be used once. If you did not request it, do not share this code.`,
  });
  return { messageId: result.messageId };
}
