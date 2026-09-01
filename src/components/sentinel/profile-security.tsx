"use client";
/* eslint-disable @next/next/no-img-element -- QR codes are local data URLs and must not be optimized remotely. */

import { KeyRound, LoaderCircle, ShieldCheck, ShieldPlus } from "lucide-react";
import { FormEvent, useState } from "react";

type Setup = { secret: string; qrDataUrl: string };

export function ProfileSecurity({ email, role, twoFactorEnabled: initialTwoFactorEnabled }: { email: string; role: string; twoFactorEnabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(initialTwoFactorEnabled);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [disabling, setDisabling] = useState(false);

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setSuccess("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ currentPassword: form.get("currentPassword"), newPassword: form.get("newPassword") }) });
    const payload = await response.json().catch(() => ({})) as { error?: string };
    setBusy(false);
    if (!response.ok) { setError(payload.error ?? "Password could not be updated"); return; }
    event.currentTarget.reset(); setSuccess("Password updated. Other active sessions were closed.");
  }

  async function startSetup() {
    setBusy(true); setError(""); setSuccess("");
    const response = await fetch("/api/auth/2fa", { method: "POST" });
    const payload = await response.json().catch(() => ({})) as Setup & { error?: string };
    setBusy(false);
    if (!response.ok) { setError(payload.error ?? "Two-factor setup could not start"); return; }
    setSetup(payload);
  }

  async function verifySetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/2fa", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: form.get("code") }) });
    const payload = await response.json().catch(() => ({})) as { error?: string };
    setBusy(false);
    if (!response.ok) { setError(payload.error ?? "Authenticator code could not be verified"); return; }
    setSetup(null); setTwoFactorEnabled(true); setSuccess("Two-factor authentication is now active.");
  }

  async function disable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/2fa", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: form.get("password"), code: form.get("code") }) });
    const payload = await response.json().catch(() => ({})) as { error?: string };
    setBusy(false);
    if (!response.ok) { setError(payload.error ?? "Two-factor authentication could not be disabled"); return; }
    setDisabling(false); setTwoFactorEnabled(false); event.currentTarget.reset(); setSuccess("Two-factor authentication was disabled.");
  }

  return <div className="mx-auto max-w-[920px] px-4 py-8 sm:px-7 lg:px-10">
    <header className="border-b border-white/[.07] pb-6"><p className="text-[9px] font-semibold uppercase tracking-[.16em] text-[#8083ed]">Account</p><h1 className="mt-2 text-2xl font-medium tracking-[-.04em]">Profile & security</h1><p className="mt-2 text-xs text-[#72767f]">Manage your ORBIT workspace access.</p></header>
    {(error || success) && <p role={error ? "alert" : "status"} className={`mt-5 rounded-xl border px-4 py-3 text-[10px] ${error ? "border-[#d58b8b]/20 bg-[#d58b8b]/[.06] text-[#e3a2a2]" : "border-[#86ba9b]/20 bg-[#86ba9b]/[.06] text-[#9fd0b2]"}`}>{error || success}</p>}
    <div className="mt-7 grid gap-5 md:grid-cols-2">
      <section className="border border-white/[.075] bg-[#0c0e12] p-5"><div className="flex items-center gap-2 text-sm font-medium"><ShieldCheck className="size-4 text-[#9294ff]" />Account details</div><dl className="mt-6 space-y-4 text-xs"><div><dt className="text-[9px] uppercase tracking-[.12em] text-[#5f636c]">Work email</dt><dd className="mt-1.5 text-[#d0d2cd]">{email}</dd></div><div><dt className="text-[9px] uppercase tracking-[.12em] text-[#5f636c]">Workspace role</dt><dd className="mt-1.5 text-[#d0d2cd]">{role.replaceAll("_", " ")}</dd></div></dl></section>
      <section className="border border-white/[.075] bg-[#0c0e12] p-5"><div className="flex items-center gap-2 text-sm font-medium"><ShieldPlus className="size-4 text-[#9294ff]" />Two-factor authentication</div><p className="mt-3 text-[10px] leading-5 text-[#737781]">Protect sign-in and every balance transfer with a code from your authenticator app.</p><div className="mt-4 flex items-center gap-2"><span className={`size-2 rounded-full ${twoFactorEnabled ? "bg-[#65d1aa]" : "bg-[#d7ad67]"}`} /><span className="text-[10px] text-[#bfc2ca]">{twoFactorEnabled ? "Active" : "Not active"}</span></div>
        {setup ? <form onSubmit={verifySetup} className="mt-5"><div className="rounded-xl bg-white p-3"><img src={setup.qrDataUrl} alt="QR code for ORBIT two-factor setup" className="mx-auto size-44" /></div><p className="mt-3 break-all font-mono text-[9px] text-[#8f94a0]">Manual key: {setup.secret}</p><label className="mt-4 block text-[10px] text-[#7f838b]">6-digit code<input required autoFocus name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" className="mt-1.5 h-10 w-full rounded-md border border-white/[.1] bg-white/[.025] px-3 text-center text-sm tracking-[.25em] text-white outline-none focus:border-[#7779ea]" /></label><button disabled={busy} className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-md bg-[#7c5cff] text-[10px] font-medium text-white disabled:opacity-50">{busy && <LoaderCircle className="size-3 animate-spin" />}Verify & enable</button></form> : twoFactorEnabled ? disabling ? <form onSubmit={disable} className="mt-5 space-y-3"><label className="block text-[10px] text-[#7f838b]">Current password<input required minLength={12} maxLength={128} name="password" type="password" autoComplete="current-password" className="mt-1.5 h-10 w-full rounded-md border border-white/[.1] bg-white/[.025] px-3 text-xs text-white outline-none focus:border-[#7779ea]" /></label><label className="block text-[10px] text-[#7f838b]">Authenticator code<input required name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} className="mt-1.5 h-10 w-full rounded-md border border-white/[.1] bg-white/[.025] px-3 text-xs text-white outline-none focus:border-[#7779ea]" /></label><div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => setDisabling(false)} className="h-9 rounded-md border border-white/[.09] text-[9px] text-[#989ca5]">Cancel</button><button disabled={busy} className="h-9 rounded-md border border-[#d58b8b]/25 text-[9px] text-[#dfa1a1] disabled:opacity-50">Disable 2FA</button></div></form> : <button type="button" onClick={() => setDisabling(true)} className="mt-5 h-9 w-full rounded-md border border-white/[.09] text-[9px] text-[#9ba0aa]">Disable two-factor authentication</button> : <button type="button" disabled={busy} onClick={() => void startSetup()} className="mt-5 flex h-9 w-full items-center justify-center gap-2 rounded-md bg-[#7c5cff] text-[10px] font-medium text-white disabled:opacity-50">{busy && <LoaderCircle className="size-3 animate-spin" />}Set up authenticator</button>}
      </section>
      <section className="border border-white/[.075] bg-[#0c0e12] p-5 md:col-span-2"><div className="flex items-center gap-2 text-sm font-medium"><KeyRound className="size-4 text-[#9294ff]" />Change password</div><form onSubmit={changePassword} className="mt-5 grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end"><label className="block text-[10px] text-[#7f838b]">Current password<input required minLength={12} maxLength={128} name="currentPassword" type="password" autoComplete="current-password" className="mt-1.5 h-10 w-full rounded-md border border-white/[.1] bg-white/[.025] px-3 text-xs text-white outline-none focus:border-[#7779ea]" /></label><label className="block text-[10px] text-[#7f838b]">New password<input required minLength={12} maxLength={128} name="newPassword" type="password" autoComplete="new-password" className="mt-1.5 h-10 w-full rounded-md border border-white/[.1] bg-white/[.025] px-3 text-xs text-white outline-none focus:border-[#7779ea]" /></label><button disabled={busy} className="h-10 rounded-md bg-[#e9eae6] px-5 text-[10px] font-medium text-black disabled:opacity-50">Update password</button></form></section>
    </div>
  </div>;
}
