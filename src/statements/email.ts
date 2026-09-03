import nodemailer from "nodemailer";
import { getServerEnv, validateStatementEmailConfiguration } from "@/sentinel/config";
import { getDatabase } from "@/sentinel/db";
import { parseAppUrlConfiguration } from "@/sentinel/app-url";
import { formatMinor } from "./calculation";

const escapeHtml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

function periodName(date: Date, timeZone: string) { return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone }).format(date); }

function errorCode(error: unknown) {
  const value = error as { code?: unknown; responseCode?: unknown };
  const raw = value?.code ?? value?.responseCode ?? "SMTP_DELIVERY_FAILED";
  return String(raw).replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 80);
}

export function statementEmailHtml(input: { merchantName: string; period: string; gross: string; fees: string; net: string; payouts: string; viewUrl: string; pdfUrl: string }) {
  const value = Object.fromEntries(Object.entries(input).map(([key, item]) => [key, escapeHtml(item)])) as Record<keyof typeof input, string>;
  return `<!doctype html><html><body style="margin:0;background:#f4f5f8;font-family:Arial,sans-serif;color:#11182f"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#fff;border-radius:18px;overflow:hidden;border:1px solid #e5e7eb"><tr><td style="height:8px;background:#6557d9"></td></tr><tr><td style="padding:38px 42px 12px"><div style="font-size:20px;font-weight:700;letter-spacing:-.5px">ORBIT</div><div style="font-size:9px;color:#7b8190;letter-spacing:1.4px;margin-top:5px">PAYMENTS INFRASTRUCTURE</div><h1 style="font-size:30px;line-height:1.15;margin:38px 0 12px">Your ${value.period} statement is ready.</h1><p style="font-size:14px;line-height:1.7;color:#596172;margin:0">Hello ${value.merchantName},<br>Your ORBIT monthly statement has been finalized and is available in your secure dashboard.</p></td></tr><tr><td style="padding:24px 42px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f7fa;border-radius:12px"><tr>${[["Gross volume", value.gross], ["Fees", value.fees], ["Net activity", value.net], ["Payouts", value.payouts]].map(([label, amount]) => `<td style="padding:18px 10px;text-align:center"><div style="font-size:9px;color:#7b8190;text-transform:uppercase">${label}</div><div style="font-size:14px;font-weight:700;margin-top:7px">${amount}</div></td>`).join("")}</tr></table></td></tr><tr><td style="padding:2px 42px 42px"><a href="${value.viewUrl}" style="display:inline-block;background:#6557d9;color:#fff;text-decoration:none;border-radius:9px;padding:14px 22px;font-size:13px;font-weight:700">View Statement</a><a href="${value.pdfUrl}" style="display:inline-block;color:#4e45b4;text-decoration:none;padding:14px 18px;font-size:13px;font-weight:700">Download PDF</a><p style="font-size:12px;line-height:1.6;color:#7b8190;margin:28px 0 0">You can access this statement at any time from your ORBIT dashboard. Sign-in is required.</p></td></tr><tr><td style="background:#11182f;color:#cdd2df;padding:26px 42px;font-size:11px;line-height:1.6"><strong style="color:#fff">ORBIT</strong><br>Payments infrastructure and account reporting<br><span style="color:#8e95a7">This statement is provided for reconciliation and recordkeeping and is not a bank statement or official tax form.</span></td></tr></table></td></tr></table></body></html>`;
}

export async function sendStatementEmail(statementId: string, options: { resentByActorId?: string; requestId?: string } = {}) {
  const env = getServerEnv();
  const statement = await getDatabase().merchantStatement.findUnique({ where: { id: statementId }, include: { merchant: { include: { agreement: true } } } });
  if (!statement || statement.status !== "FINALIZED") throw new Error("FINALIZED_STATEMENT_NOT_FOUND");
  const attempt = statement.emailAttemptCount + 1;
  await getDatabase().merchantStatement.update({ where: { id: statement.id }, data: { emailStatus: "SENDING", emailAttemptCount: attempt, lastEmailAttemptAt: new Date(), lastEmailErrorCode: null } });
  try {
    validateStatementEmailConfiguration(env);
    if (!env.SMTP_HOST || !env.SMTP_USERNAME || !env.SMTP_PASSWORD || !env.SMTP_FROM_EMAIL) throw new Error("SMTP_NOT_CONFIGURED");
    const recipient = statement.merchant.agreement?.primaryContactEmail;
    if (!recipient) throw new Error("MERCHANT_FINANCIAL_EMAIL_UNAVAILABLE");
    const base = parseAppUrlConfiguration(env.APP_URL).canonicalOrigin;
    const viewUrl = `${base}/dashboard/statements/${encodeURIComponent(statement.publicId)}`;
    const pdfUrl = `${base}/api/portal/statements/${encodeURIComponent(statement.publicId)}/pdf`;
    const fees = statement.processingFeesMinor + statement.orbitFeesMinor;
    const transport = nodemailer.createTransport({
      host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_SECURITY === "tls", requireTLS: env.SMTP_SECURITY === "starttls",
      auth: { user: env.SMTP_USERNAME, pass: env.SMTP_PASSWORD }, tls: { rejectUnauthorized: true },
    });
    const result = await transport.sendMail({
      from: { name: env.SMTP_FROM_NAME, address: env.SMTP_FROM_EMAIL }, replyTo: env.SMTP_REPLY_TO, to: recipient,
      subject: `Your ORBIT Statement — ${periodName(statement.periodStart, env.STATEMENT_TIMEZONE)}`,
      html: statementEmailHtml({ merchantName: statement.merchant.businessName, period: periodName(statement.periodStart, env.STATEMENT_TIMEZONE), gross: formatMinor(statement.grossPaymentsMinor, statement.currency), fees: formatMinor(fees, statement.currency), net: formatMinor(statement.netActivityMinor, statement.currency), payouts: formatMinor(statement.payoutsMinor, statement.currency), viewUrl, pdfUrl }),
      text: `Hello ${statement.merchant.businessName},\n\nYour ORBIT monthly statement for ${periodName(statement.periodStart, env.STATEMENT_TIMEZONE)} is ready.\n\nView statement: ${viewUrl}\nDownload PDF: ${pdfUrl}\n\nThis statement is for reconciliation and recordkeeping and is not a bank statement or official tax form.`,
    });
    await getDatabase().$transaction([
      getDatabase().merchantStatement.update({ where: { id: statement.id }, data: { emailStatus: "SENT", emailSentAt: new Date(), emailMessageId: result.messageId, lastEmailErrorCode: null } }),
      getDatabase().statementDeliveryAttempt.create({ data: { statementId: statement.id, attempt, status: "SENT", messageId: result.messageId } }),
      getDatabase().auditLog.create({ data: { organizationId: statement.merchant.organizationId, merchantId: statement.merchantId, actorId: options.resentByActorId, action: "STATEMENT_EMAIL_SENT", targetType: "MerchantStatement", targetId: statement.id, requestId: options.requestId, metadata: { attempt, resent: Boolean(options.resentByActorId) } } }),
      ...(options.resentByActorId ? [getDatabase().auditLog.create({ data: { organizationId: statement.merchant.organizationId, merchantId: statement.merchantId, actorId: options.resentByActorId, action: "STATEMENT_EMAIL_RESENT", targetType: "MerchantStatement", targetId: statement.id, requestId: options.requestId, metadata: { attempt } } })] : []),
    ]);
    return { sent: true as const, attempt, messageId: result.messageId };
  } catch (error) {
    const code = errorCode(error);
    await getDatabase().$transaction([
      getDatabase().merchantStatement.update({ where: { id: statement.id }, data: { emailStatus: "FAILED", lastEmailErrorCode: code } }),
      getDatabase().statementDeliveryAttempt.create({ data: { statementId: statement.id, attempt, status: "FAILED", errorCode: code } }),
      getDatabase().auditLog.create({ data: { organizationId: statement.merchant.organizationId, merchantId: statement.merchantId, actorId: options.resentByActorId, action: "STATEMENT_EMAIL_FAILED", targetType: "MerchantStatement", targetId: statement.id, requestId: options.requestId, metadata: { attempt, errorCode: code } } }),
    ]);
    return { sent: false as const, attempt, errorCode: code };
  }
}
