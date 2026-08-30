"use client";

import { FormEvent, useState } from "react";
import { ArrowUpRight, CheckCircle2 } from "lucide-react";

const fields = [
  { name: "name", label: "Name", type: "text", placeholder: "Your name" },
  { name: "email", label: "Work email", type: "email", placeholder: "you@company.com" },
  { name: "company", label: "Company", type: "text", placeholder: "Company name" },
  { name: "website", label: "Website", type: "url", placeholder: "https://company.com" },
  { name: "role", label: "Role", type: "text", placeholder: "Your role" },
] as const;

export function ContactForm() {
  const [state, setState] = useState<"idle" | "sending" | "success" | "error">("idle");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("sending");
    const form = event.currentTarget;
    const response = await fetch("/api/contact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(form))) }).catch(() => null);
    if (response?.ok) { setState("success"); form.reset(); } else setState("error");
  }

  return (
    <form onSubmit={submit} className="panel min-w-0 max-w-full rounded-[6px] p-5 sm:p-8">
      <div className="grid gap-5 sm:grid-cols-2">
        {fields.map((field) => <label key={field.name} className="block"><span className="mb-2 block text-xs text-[#a6a8af]">{field.label}</span><input className="form-field" required name={field.name} type={field.type} placeholder={field.placeholder} autoComplete={field.name === "email" ? "email" : field.name === "name" ? "name" : field.name === "company" ? "organization" : field.name === "website" ? "url" : "organization-title"}/></label>)}
        <label className="block sm:col-span-2"><span className="mb-2 block text-xs text-[#a6a8af]">Message</span><textarea className="form-field min-h-32 resize-y" required name="message" placeholder="Tell us what you are looking to monitor."/></label>
      </div>
      <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <button disabled={state === "sending"} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[6px] bg-[#ff6547] px-5 text-sm font-medium text-[#140806] transition hover:bg-[#ff8068] disabled:cursor-wait disabled:opacity-60" type="submit">{state === "sending" ? "Submitting…" : "Talk to ORBIT"}<ArrowUpRight className="size-3.5"/></button>
        <p aria-live="polite" className={`text-xs ${state === "error" ? "text-[#eca0a0]" : "text-[#9ee6b3]"}`}>{state === "success" && <span className="inline-flex items-center gap-2"><CheckCircle2 className="size-3.5"/>Your message has been received.</span>}{state === "error" && "We could not accept the message. Please try again."}</p>
      </div>
      <p className="mt-5 text-[10px] leading-5 text-[#5e6169]">Your details are used only to review your message and respond.</p>
    </form>
  );
}
