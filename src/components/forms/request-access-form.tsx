"use client";

import { FormEvent, useState } from "react";
import { ArrowUpRight, CheckCircle2 } from "lucide-react";

const monitorOptions = ["Website compliance", "Merchant risk", "Policy coverage", "Change monitoring", "Audit history", "Other"];

export function RequestAccessForm() {
  const [state, setState] = useState<"idle" | "sending" | "success" | "error">("idle");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("sending");
    const form = event.currentTarget;
    const data = new FormData(form);
    const payload = Object.fromEntries(data);
    payload.monitoring = data.getAll("monitoring").join(", ");
    const response = await fetch("/api/request-access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }).catch(() => null);
    if (response?.ok) { setState("success"); form.reset(); } else setState("error");
  }

  return (
    <form onSubmit={submit} className="panel min-w-0 max-w-full rounded-[6px] p-5 sm:p-8">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field name="firstName" label="First name" placeholder="First name" autoComplete="given-name" />
        <Field name="lastName" label="Last name" placeholder="Last name" autoComplete="family-name" />
        <Field name="email" label="Work email" type="email" placeholder="you@company.com" autoComplete="email" />
        <Field name="company" label="Company" placeholder="Company name" autoComplete="organization" />
        <Field name="website" label="Website" type="url" placeholder="https://company.com" autoComplete="url" />
        <label><span className="mb-2 block text-xs text-[#a6a8af]">Industry</span><select required name="industry" defaultValue="" className="form-field"><option value="" disabled>Select industry</option><option>Research products</option><option>Supplements</option><option>Cosmetics</option><option>High-risk ecommerce</option><option>Subscription commerce</option><option>Digital services</option><option>Other</option></select></label>
        <label><span className="mb-2 block text-xs text-[#a6a8af]">Monthly online volume</span><select required name="volume" defaultValue="" className="form-field"><option value="" disabled>Select volume</option><option>Under $50K</option><option>$50K–$250K</option><option>$250K–$1M</option><option>$1M–$5M</option><option>$5M+</option></select></label>
        <Field name="role" label="Role" placeholder="Your role" autoComplete="organization-title" />
      </div>
      <fieldset className="mt-7"><legend className="text-xs text-[#a6a8af]">What are you looking to monitor?</legend><div className="mt-3 grid gap-2 sm:grid-cols-2">{monitorOptions.map(option => <label key={option} className="flex cursor-pointer items-center gap-3 rounded-[5px] border border-white/[.08] bg-white/[.018] p-3 text-xs text-[#9ea1a9] transition hover:border-white/[.15]"><input type="checkbox" name="monitoring" value={option} className="size-3.5 accent-[#7c5cff]"/><span>{option}</span></label>)}</div></fieldset>
      <label className="mt-6 block"><span className="mb-2 block text-xs text-[#a6a8af]">Additional context <span className="text-[#5d6068]">(optional)</span></span><textarea name="context" className="form-field min-h-28 resize-y" placeholder="Tell us about your monitoring goals or current workflow."/></label>
      <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><button disabled={state === "sending"} type="submit" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[6px] bg-[#7c5cff] px-5 text-sm font-medium text-white transition hover:bg-[#9278ff] disabled:cursor-wait disabled:opacity-60">{state === "sending" ? "Submitting…" : "Request access"}<ArrowUpRight className="size-3.5"/></button><p aria-live="polite" className={`text-xs ${state === "error" ? "text-[#eca0a0]" : "text-[#6ee7c3]"}`}>{state === "success" && <span className="inline-flex items-center gap-2"><CheckCircle2 className="size-3.5"/>Your request has been received.</span>}{state === "error" && "We could not accept the request. Please try again."}</p></div>
      <p className="mt-5 text-[10px] leading-5 text-[#5e6169]">Your details are used only to evaluate product fit and respond to your request.</p>
    </form>
  );
}

function Field({ name, label, type = "text", placeholder, autoComplete }: { name: string; label: string; type?: string; placeholder: string; autoComplete?: string }) {
  return <label><span className="mb-2 block text-xs text-[#a6a8af]">{label}</span><input required name={name} type={type} placeholder={placeholder} autoComplete={autoComplete} className="form-field"/></label>;
}
