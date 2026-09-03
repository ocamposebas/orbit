import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createTransport: vi.fn(), sendMail: vi.fn() }));

vi.mock("nodemailer", () => ({ default: { createTransport: mocks.createTransport } }));
vi.mock("@/sentinel/config", () => ({
  getServerEnv: () => ({
    SMTP_HOST: "smtp.phaseonelabz.com",
    SMTP_PORT: 587,
    SMTP_SECURITY: "starttls",
    SMTP_USERNAME: "orbit-smtp-user",
    SMTP_PASSWORD: "secret-not-for-output",
    SMTP_FROM_EMAIL: "orbit@phaseonelabz.com",
    SMTP_FROM_NAME: "ORBIT",
    SMTP_REPLY_TO: undefined,
  }),
  validateSmtpConfiguration: () => ({ configured: true }),
}));

import { sendLoginVerificationEmail } from "@/sentinel/auth/login-email";

describe("login email SMTP delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createTransport.mockReturnValue({ sendMail: mocks.sendMail });
    mocks.sendMail.mockResolvedValue({ messageId: "smtp-message-id" });
  });

  it("requires STARTTLS and addresses only the registered recipient", async () => {
    const result = await sendLoginVerificationEmail({ recipient: "correct.person@example.com", name: "Correct Person", code: "042731" });
    expect(result).toEqual({ messageId: "smtp-message-id" });
    expect(mocks.createTransport).toHaveBeenCalledWith(expect.objectContaining({
      host: "smtp.phaseonelabz.com",
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: "orbit-smtp-user", pass: "secret-not-for-output" },
      tls: { rejectUnauthorized: true },
    }));
    expect(mocks.sendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: { name: "ORBIT", address: "orbit@phaseonelabz.com" },
      to: "correct.person@example.com",
      subject: "Your ORBIT sign-in code",
      text: expect.stringContaining("042731"),
      html: expect.stringContaining("042731"),
    }));
  });
});
