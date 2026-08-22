"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { ArrowRight, Eye, EyeOff } from "lucide-react";

export function LoginForm() {
  const [show, setShow] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setBusy(true); setNotice(""); const form = new FormData(event.currentTarget); try { const response = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: form.get("email"), password: form.get("password") }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Unable to sign in"); const next = new URLSearchParams(window.location.search).get("next"); window.location.assign(next?.startsWith("/sentinel") ? next : "/sentinel"); } catch (error) { setNotice(error instanceof Error ? error.message : "Unable to sign in"); setBusy(false); } }
  return <form onSubmit={submit}>
    <label className="block"><span className="mb-2 block text-xs text-[#a6a8af]">Work email</span><input required name="email" type="email" autoComplete="email" className="form-field" placeholder="you@company.com"/></label>
    <label className="mt-5 block"><span className="mb-2 block text-xs text-[#a6a8af]">Password</span><span className="relative block"><input required minLength={12} maxLength={128} name="password" type={show ? "text" : "password"} autoComplete="current-password" className="form-field pr-12" placeholder="Your password"/><button type="button" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"} className="absolute right-1 top-1 grid size-10 place-items-center text-[#696c75] hover:text-white">{show ? <EyeOff className="size-4"/> : <Eye className="size-4"/>}</button></span></label>
    <div className="mt-3 flex justify-end"><button type="button" onClick={() => setNotice("Contact your workspace administrator to reset your password.")} className="text-xs text-[#81848d] transition hover:text-white">Forgot password?</button></div>
    <button disabled={busy} type="submit" className="mt-6 flex min-h-11 w-full items-center justify-center gap-2 rounded-[9px] bg-[#f2f0eb] px-4 text-sm font-medium text-[#090a0c] transition hover:bg-white disabled:cursor-wait disabled:opacity-60">{busy ? "Signing in…" : "Sign in"}<ArrowRight className="size-3.5"/></button>
    <p aria-live="polite" className="mt-4 min-h-5 text-center text-[11px] text-[#e7c98d]">{notice}</p>
    <p className="mt-6 text-center text-xs text-[#666a73]">Need an ORBIT workspace? <Link href="/request-access" className="text-[#b8b9f5] hover:text-white">Request access</Link></p>
  </form>;
}
