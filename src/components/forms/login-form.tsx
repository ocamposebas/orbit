"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Eye, EyeOff, ShieldCheck } from "lucide-react";

export function LoginForm({ nextPath = "/sentinel" }: { nextPath?: string }) {
  const [show, setShow] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<"credentials" | "email" | "authenticator">("credentials");
  const [emailHint, setEmailHint] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setNotice("");
    const form = new FormData(event.currentTarget);
    try {
      const endpoint = step === "credentials" ? "/api/auth/login" : step === "email" ? "/api/auth/email-code/login" : "/api/auth/2fa/login";
      const response = await fetch(endpoint, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(step === "credentials" ? { email: form.get("email"), password: form.get("password") } : { code: form.get("code") }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Unable to sign in");
      if (data.emailVerificationRequired) { setEmailHint(data.emailHint ?? "your registered email"); setStep("email"); setBusy(false); return; }
      if (data.twoFactorRequired) { setStep("authenticator"); setBusy(false); return; }
      window.location.assign(nextPath);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Unable to sign in"); setBusy(false); }
  }

  async function resend() {
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/auth/email-code/resend", { method: "POST", headers: { "content-type": "application/json" } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Unable to resend the code");
      setEmailHint(data.emailHint ?? emailHint);
      setNotice(`A new code was sent to ${data.emailHint ?? emailHint}.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Unable to resend the code"); }
    finally { setBusy(false); }
  }

  return <form onSubmit={submit}>
    {step === "authenticator" ? <>
      <div className="mb-6 rounded-xl border border-[#7c5cff]/20 bg-[#7c5cff]/[.07] p-4"><ShieldCheck className="size-5 text-[#a99cff]" /><p className="mt-3 text-sm font-medium text-white">Two-factor verification</p><p className="mt-1 text-[11px] leading-5 text-[#858994]">Enter the current 6-digit code from your authenticator app.</p></div>
      <label className="block"><span className="mb-2 block text-xs text-[#a6a8af]">Authenticator code</span><input required autoFocus name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} className="form-field text-center text-xl tracking-[.35em]" placeholder="000000" /></label>
      <button type="button" onClick={() => { setStep("credentials"); setNotice(""); }} className="mt-4 inline-flex items-center gap-1.5 text-[11px] text-[#7f838d] hover:text-white"><ArrowLeft className="size-3" />Start over</button>
    </> : step === "email" ? <>
      <div className="mb-6 rounded-xl border border-[#7c5cff]/20 bg-[#7c5cff]/[.07] p-4"><ShieldCheck className="size-5 text-[#a99cff]" /><p className="mt-3 text-sm font-medium text-white">Check your email</p><p className="mt-1 text-[11px] leading-5 text-[#858994]">We sent a 6-digit, one-time code to <span className="text-[#c5c6d0]">{emailHint}</span>. It expires in 10 minutes.</p></div>
      <label className="block"><span className="mb-2 block text-xs text-[#a6a8af]">Email verification code</span><input required autoFocus name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} className="form-field text-center text-xl tracking-[.35em]" placeholder="000000" /></label>
      <div className="mt-4 flex items-center justify-between"><button type="button" onClick={() => { setStep("credentials"); setNotice(""); }} className="inline-flex items-center gap-1.5 text-[11px] text-[#7f838d] hover:text-white"><ArrowLeft className="size-3" />Use another account</button><button type="button" disabled={busy} onClick={() => void resend()} className="text-[11px] text-[#a9aaf0] hover:text-white disabled:opacity-50">Resend code</button></div>
    </> : <>
      <label className="block"><span className="mb-2 block text-xs text-[#a6a8af]">Work email</span><input required name="email" type="email" autoComplete="email" className="form-field" placeholder="you@company.com" /></label>
      <label className="mt-5 block"><span className="mb-2 block text-xs text-[#a6a8af]">Password</span><span className="relative block"><input required minLength={12} maxLength={128} name="password" type={show ? "text" : "password"} autoComplete="current-password" className="form-field pr-12" placeholder="Your password" /><button type="button" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"} className="absolute right-1 top-1 grid size-10 place-items-center text-[#696c75] hover:text-white">{show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button></span></label>
      <div className="mt-3 flex justify-end"><button type="button" onClick={() => setNotice("Contact your workspace administrator to reset your password.")} className="text-xs text-[#81848d] transition hover:text-white">Forgot password?</button></div>
    </>}
    <button disabled={busy} type="submit" className="mt-6 flex min-h-11 w-full items-center justify-center gap-2 rounded-[6px] bg-[#7c5cff] px-4 text-sm font-medium text-white transition hover:bg-[#9278ff] disabled:cursor-wait disabled:opacity-60">{busy ? "Verifying…" : step === "credentials" ? "Continue securely" : "Verify & sign in"}<ArrowRight className="size-3.5" /></button>
    <p aria-live="polite" className="mt-4 min-h-5 text-center text-[11px] text-[#e7c98d]">{notice}</p>
    <p className="mt-6 text-center text-xs text-[#666a73]">Need an ORBIT workspace? <Link href="/request-access" className="text-[#b8b9f5] hover:text-white">Request access</Link></p>
  </form>;
}
