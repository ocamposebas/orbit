"use client";

import { KeyRound, ShieldCheck } from "lucide-react";
import { FormEvent, useState } from "react";

export function ProfileSecurity({ email, role }: { email: string; role: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSuccess("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword: form.get("currentPassword"), newPassword: form.get("newPassword") }),
    });
    const payload = await response.json().catch(() => ({})) as { error?: string };
    setBusy(false);
    if (!response.ok) {
      setError(payload.error ?? "Password could not be updated");
      return;
    }
    event.currentTarget.reset();
    setSuccess("Password updated. Other active sessions were closed.");
  }

  return <div className="mx-auto max-w-[920px] px-4 py-8 sm:px-7 lg:px-10">
    <header className="border-b border-white/[.07] pb-6">
      <p className="text-[9px] font-semibold uppercase tracking-[.16em] text-[#8083ed]">Account</p>
      <h1 className="mt-2 text-2xl font-medium tracking-[-.04em]">Profile & security</h1>
      <p className="mt-2 text-xs text-[#72767f]">Manage your ORBIT workspace access.</p>
    </header>
    <div className="mt-7 grid gap-5 md:grid-cols-2">
      <section className="border border-white/[.075] bg-[#0c0e12] p-5">
        <div className="flex items-center gap-2 text-sm font-medium"><ShieldCheck className="size-4 text-[#9294ff]" />Account details</div>
        <dl className="mt-6 space-y-4 text-xs">
          <div><dt className="text-[9px] uppercase tracking-[.12em] text-[#5f636c]">Work email</dt><dd className="mt-1.5 text-[#d0d2cd]">{email}</dd></div>
          <div><dt className="text-[9px] uppercase tracking-[.12em] text-[#5f636c]">Workspace role</dt><dd className="mt-1.5 text-[#d0d2cd]">{role.replaceAll("_", " ")}</dd></div>
        </dl>
      </section>
      <section className="border border-white/[.075] bg-[#0c0e12] p-5">
        <div className="flex items-center gap-2 text-sm font-medium"><KeyRound className="size-4 text-[#9294ff]" />Change password</div>
        <form onSubmit={submit} className="mt-5 space-y-4">
          <label className="block text-[10px] text-[#7f838b]">Current password<input required minLength={12} maxLength={128} name="currentPassword" type="password" autoComplete="current-password" className="mt-1.5 h-10 w-full rounded-md border border-white/[.1] bg-white/[.025] px-3 text-xs text-white outline-none focus:border-[#7779ea]" /></label>
          <label className="block text-[10px] text-[#7f838b]">New password<input required minLength={12} maxLength={128} name="newPassword" type="password" autoComplete="new-password" className="mt-1.5 h-10 w-full rounded-md border border-white/[.1] bg-white/[.025] px-3 text-xs text-white outline-none focus:border-[#7779ea]" /></label>
          {error && <p role="alert" className="text-[10px] leading-4 text-[#d58b8b]">{error}</p>}
          {success && <p role="status" className="text-[10px] leading-4 text-[#86ba9b]">{success}</p>}
          <button disabled={busy} className="flex h-9 w-full items-center justify-center rounded-md bg-[#e9eae6] text-[10px] font-medium text-black disabled:opacity-50">{busy ? "Updating…" : "Update password"}</button>
          <p className="text-[9px] leading-4 text-[#555a62]">Use at least 12 characters. Your current session remains active.</p>
        </form>
      </section>
    </div>
  </div>;
}
