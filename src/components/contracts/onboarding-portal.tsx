"use client";

import { ArrowDownToLine, ArrowRight, Check, FileCheck2, FileSignature, Fingerprint, LockKeyhole, Orbit, ShieldCheck, UploadCloud } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";

type AgreementState = {
  status: "INVITED" | "DATA_COMPLETED" | "CONTRACT_ISSUED" | "SIGNED_LOCKED";
  locked: boolean;
  expiresAt: string;
  termsVersion: string;
  selfServe: boolean;
  merchant: { businessName: string; industry: string; website: string; operatingCountry: string; businessDescription: string };
  completed: boolean;
  contractReady: boolean;
  signedUploadedAt?: string;
  signedOriginalName?: string;
};

const inputClass = "mt-2 h-12 w-full rounded-xl border border-white/[.11] bg-white/[.035] px-4 text-sm text-white outline-none transition placeholder:text-[#555b66] hover:border-white/[.18] focus:border-[#8e91ff] focus:bg-white/[.055] focus:ring-4 focus:ring-[#7d80ff]/10";
const textareaClass = `${inputClass} h-auto min-h-28 resize-y py-3 leading-6`;

async function responseJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "We could not complete this request");
  return data;
}

export function OnboardingPortal({ token }: { token: string }) {
  const [agreement, setAgreement] = useState<AgreementState>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    fetch(`/api/onboarding/${token}`, { cache: "no-store" })
      .then((response) => responseJson<{ agreement: AgreementState }>(response))
      .then((data) => { if (active) setAgreement(data.agreement); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "Invitation unavailable"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token]);

  const activeStep = agreement?.status === "INVITED" ? 1 : agreement?.status === "SIGNED_LOCKED" ? 3 : 2;
  const expires = useMemo(() => agreement ? new Date(agreement.expiresAt).toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" }) : "", [agreement]);

  async function submitIntake(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form);
    Object.assign(payload, { certifyAuthority: form.has("certifyAuthority"), certifyAccuracy: form.has("certifyAccuracy"), acceptElectronicProcess: form.has("acceptElectronicProcess") });
    try {
      const data = await responseJson<{ agreement: AgreementState }>(await fetch(`/api/onboarding/${token}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }));
      setAgreement(data.agreement); window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "We could not certify the information"); }
    finally { setBusy(false); }
  }

  async function uploadSigned(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const data = await responseJson<{ agreement: AgreementState }>(await fetch(`/api/onboarding/${token}/signed`, { method: "POST", body: new FormData(event.currentTarget) }));
      setAgreement(data.agreement); window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "We could not store the signed agreement"); }
    finally { setBusy(false); }
  }

  return <div className="relative min-h-dvh overflow-hidden bg-[#080a0e] text-[#f2f3ef]">
    <div className="pointer-events-none absolute inset-0 opacity-70 [background-image:radial-gradient(circle_at_16%_8%,rgba(105,108,255,.19),transparent_28%),radial-gradient(circle_at_90%_35%,rgba(45,204,188,.08),transparent_22%),linear-gradient(rgba(255,255,255,.018)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.018)_1px,transparent_1px)] [background-size:auto,auto,56px_56px,56px_56px]" />
    <header className="relative z-10 mx-auto flex h-20 max-w-[1380px] items-center border-b border-white/[.07] px-5 sm:px-8">
      <div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-full border border-[#8c8fff]/35 bg-[#8c8fff]/10"><Orbit className="size-4 text-[#a7a9ff]" /></span><span><b className="block text-sm tracking-[.18em]">ORBIT</b><small className="text-[8px] uppercase tracking-[.2em] text-[#666d78]">Secure onboarding</small></span></div>
      <div className="ml-auto flex items-center gap-2 rounded-full border border-white/[.08] bg-white/[.025] px-3 py-2 text-[9px] uppercase tracking-[.13em] text-[#7f8590]"><LockKeyhole className="size-3 text-[#7ed6ba]" />Private record</div>
    </header>

    <main className="relative z-10 mx-auto w-full max-w-[1180px] px-5 pb-20 pt-10 sm:px-8 lg:pt-16">
      {loading ? <LoadingState /> : error && !agreement ? <UnavailableState message={error} /> : agreement ? <>
        <div className="grid gap-10 lg:grid-cols-[1fr_310px] lg:gap-16">
          <div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-[#9295ff]">Participation and monitoring agreement</p><h1 className="mt-4 max-w-3xl text-4xl font-medium tracking-[-.055em] text-balance sm:text-5xl lg:text-[58px] lg:leading-[1.02]">One clear record.<br/><span className="text-[#858a95]">One final version.</span></h1><p className="mt-6 max-w-2xl text-sm leading-7 text-[#858b96]">{agreement.merchant.businessName ? `${agreement.merchant.businessName} has been invited` : "Your company has been invited"} to provide the information ORBIT will use to create its monitoring profile and issue the agreement. Each stage is recorded, and the record is permanently locked when the signed copy is received.</p></div>
          <aside className="border-l border-white/[.08] pl-6"><p className="text-[9px] uppercase tracking-[.16em] text-[#5f6570]">Record progress</p><div className="mt-5 space-y-1">{[[1, "Merchant information", "Business, legal and operating data"], [2, "Agreement issued", "Download, sign and upload"], [3, "Record closed", "No further changes permitted"]].map(([step, title, detail]) => <div key={String(step)} className="flex gap-3 py-3"><span className={`grid size-6 shrink-0 place-items-center rounded-full border text-[9px] ${Number(step) < activeStep ? "border-[#76d6b2]/35 bg-[#76d6b2]/10 text-[#83dfbc]" : Number(step) === activeStep ? "border-[#9295ff]/60 bg-[#9295ff]/15 text-white" : "border-white/[.1] text-[#565c66]"}`}>{Number(step) < activeStep ? <Check className="size-3" /> : step}</span><span><b className={`block text-[11px] font-medium ${Number(step) <= activeStep ? "text-[#d9dbd6]" : "text-[#626873]"}`}>{title}</b><small className="mt-1 block text-[9px] text-[#555b66]">{detail}</small></span></div>)}</div>{!agreement.locked && <p className="mt-5 border-t border-white/[.07] pt-4 text-[9px] leading-5 text-[#5d636e]">This link remains valid through {expires}. Terms version {agreement.termsVersion}.</p>}</aside>
        </div>
        {error && <div role="alert" className="mt-8 border border-[#e98484]/20 bg-[#e98484]/[.055] px-4 py-3 text-xs text-[#e3a0a0]">{error}</div>}
        {agreement.status === "INVITED" && <IntakeForm agreement={agreement} busy={busy} onSubmit={submitIntake} />}
        {["DATA_COMPLETED", "CONTRACT_ISSUED"].includes(agreement.status) && <ContractStage token={token} busy={busy} onSubmit={uploadSigned} />}
        {agreement.status === "SIGNED_LOCKED" && <LockedState agreement={agreement} />}
      </> : null}
    </main>
  </div>;
}

function IntakeForm({ agreement, busy, onSubmit }: { agreement: AgreementState; busy: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <form onSubmit={onSubmit} className="mt-14 space-y-6">
    <FormSection number="01" title="Business profile" description="This information will automatically create your merchant profile and the website ORBIT will monitor."><Field label="Business name" name="businessName" placeholder="Name your customers recognize" defaultValue={agreement.merchant.businessName} /><Field label="Public website" name="publicWebsite" type="url" placeholder="https://company.com" defaultValue={agreement.merchant.website} /><Field label="Industry" name="industry" placeholder="Software, e-commerce, professional services..." defaultValue={agreement.merchant.industry} /><Field label="Operating country or market" name="operatingCountry" placeholder="United States, Colombia..." defaultValue={agreement.merchant.operatingCountry} /><TextField label="Business description" name="businessDescription" placeholder="Describe your products, customers, sales channels and operating model." defaultValue={agreement.merchant.businessDescription} /></FormSection>
    <FormSection number="02" title="Legal identity" description="Enter these details exactly as they appear in your incorporation and tax records."><Field label="Legal business name" name="legalName" placeholder="Full legal entity name" /><Field label="Trade name / DBA" name="tradeName" placeholder="Optional" required={false} /><Field label="Entity type" name="entityType" placeholder="LLC, corporation, partnership..." /><Field label="Tax identifier" name="taxId" placeholder="EIN, NIT or equivalent" /><Field label="Business registration number" name="registrationNumber" placeholder="Optional" required={false} /><Field label="Legal country code" name="countryCode" placeholder="US" maxLength={2} /></FormSection>
    <FormSection number="03" title="Address and contact" description="We use these details to identify the parties and deliver contractual notices."><Field label="Legal business address" name="businessAddress" placeholder="Street, number and unit" wide /><Field label="City" name="city" placeholder="City" /><Field label="State / province / region" name="region" placeholder="State or region" /><Field label="Postal code" name="postalCode" placeholder="Postal code" /><Field label="Authorized contact name" name="primaryContactName" placeholder="Full name" /><Field label="Role or title" name="primaryContactRole" placeholder="CEO, director, legal representative..." /><Field label="Contract email" name="primaryContactEmail" type="email" placeholder="legal@company.com" /><Field label="Phone number" name="primaryContactPhone" type="tel" placeholder="+1 555 000 0000" /></FormSection>
    <FormSection number="04" title="Monitoring scope and operations" description="Define what ORBIT will observe and provide the operating context used in your agreement."><TextField label="Covered websites, domains, subdomains and channels" name="coveredDomains" placeholder="Enter one URL or domain per line" defaultValue={agreement.merchant.website} /><TextField label="Products and services" name="productsAndServices" placeholder="Describe products, audience, sales model, subscriptions, fulfillment and any regulated categories." /><Field label="Requested billing descriptor" name="billingDescriptor" placeholder="CUSTOMER STATEMENT NAME" /><Field label="Estimated monthly volume" name="estimatedMonthlyVolume" placeholder="USD 25,000" /><Field label="Average transaction amount" name="averageTransactionAmount" placeholder="USD 75" /><Field label="Highest expected transaction" name="highestTransactionAmount" placeholder="USD 500" /></FormSection>
    <section className="overflow-hidden rounded-2xl border border-[#9295ff]/20 bg-[#9295ff]/[.045]"><div className="grid gap-6 p-6 lg:grid-cols-[1fr_1.2fr] lg:p-8"><div><Fingerprint className="size-5 text-[#9b9eff]" /><h2 className="mt-4 text-xl font-medium tracking-[-.03em]">Submitter certification</h2><p className="mt-3 text-xs leading-6 text-[#777e89]">When you continue, the certified information is frozen to create one definitive agreement.</p></div><div className="space-y-3"><CheckField name="certifyAuthority">I represent that I have sufficient authority to represent and bind the merchant.</CheckField><CheckField name="certifyAccuracy">I certify that the information provided is true, complete and current.</CheckField><CheckField name="acceptElectronicProcess">I consent to electronic records, communications and documents for this process.</CheckField></div></div><div className="flex flex-col gap-4 border-t border-white/[.08] bg-black/10 px-6 py-5 sm:flex-row sm:items-center sm:justify-between lg:px-8"><p className="max-w-xl text-[10px] leading-5 text-[#626975]">After certification, these fields cannot be edited from this link. Review every entry carefully before continuing.</p><button disabled={busy} className="inline-flex h-12 items-center justify-center gap-3 rounded-xl bg-[#f1f1ed] px-6 text-xs font-semibold text-[#0c0e12] transition hover:bg-white disabled:opacity-50">{busy ? "Certifying..." : "Certify and generate agreement"}<ArrowRight className="size-4" /></button></div></section>
  </form>;
}

function FormSection({ number, title, description, children }: { number: string; title: string; description: string; children: React.ReactNode }) { return <section className="overflow-hidden rounded-2xl border border-white/[.08] bg-[#0d1015]/90 shadow-[0_30px_90px_rgba(0,0,0,.22)]"><div className="grid border-b border-white/[.07] p-6 lg:grid-cols-[220px_1fr] lg:p-8"><div><span className="font-mono text-[9px] text-[#8f92fa]">{number} / 04</span><h2 className="mt-3 text-xl font-medium tracking-[-.035em]">{title}</h2></div><p className="mt-3 max-w-xl text-xs leading-6 text-[#707782] lg:mt-0">{description}</p></div><div className="grid gap-5 p-6 sm:grid-cols-2 lg:p-8">{children}</div></section>; }
function Field({ label, name, placeholder, type = "text", defaultValue, required = true, wide = false, maxLength }: { label: string; name: string; placeholder: string; type?: string; defaultValue?: string; required?: boolean; wide?: boolean; maxLength?: number }) { return <label className={`text-[10px] font-medium text-[#9ba0a8] ${wide ? "sm:col-span-2" : ""}`}>{label}{!required && <span className="ml-2 font-normal text-[#565d67]">Optional</span>}<input className={inputClass} required={required} name={name} type={type} placeholder={placeholder} defaultValue={defaultValue} maxLength={maxLength} autoComplete="off" /></label>; }
function TextField({ label, name, placeholder, defaultValue }: { label: string; name: string; placeholder: string; defaultValue?: string }) { return <label className="text-[10px] font-medium text-[#9ba0a8] sm:col-span-2">{label}<textarea className={textareaClass} required name={name} placeholder={placeholder} defaultValue={defaultValue} /></label>; }
function CheckField({ name, children }: { name: string; children: React.ReactNode }) { return <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/[.075] bg-black/10 p-4 text-[11px] leading-5 text-[#a9adb4]"><input required type="checkbox" name={name} className="mt-0.5 size-4 shrink-0 accent-[#8588ff]" />{children}</label>; }

function ContractStage({ token, busy, onSubmit }: { token: string; busy: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const [confirmed, setConfirmed] = useState(false);
  return <div className="mt-14 grid gap-6 lg:grid-cols-2"><section className="relative overflow-hidden rounded-2xl border border-white/[.09] bg-[#101319] p-7 lg:p-9"><div className="absolute right-0 top-0 size-44 translate-x-12 -translate-y-12 rounded-full bg-[#8588ff]/10 blur-3xl"/><span className="grid size-11 place-items-center rounded-xl border border-[#8588ff]/25 bg-[#8588ff]/10"><FileSignature className="size-5 text-[#9c9fff]" /></span><p className="mt-7 text-[9px] font-semibold uppercase tracking-[.18em] text-[#777e89]">Step 1 · Agreement issued</p><h2 className="mt-3 text-2xl font-medium tracking-[-.04em]">Download the final version</h2><p className="mt-4 text-xs leading-6 text-[#777e89]">The PDF includes the certified information, terms version and signature blocks for the merchant and Sebastian Ocampo.</p><a href={`/api/onboarding/${token}/contract`} className="mt-8 inline-flex h-12 items-center gap-3 rounded-xl bg-[#f1f1ed] px-5 text-xs font-semibold text-[#0c0e12] hover:bg-white"><ArrowDownToLine className="size-4" />Download agreement PDF</a></section><form onSubmit={onSubmit} className="overflow-hidden rounded-2xl border border-white/[.09] bg-[#101319]"><div className="p-7 lg:p-9"><span className="grid size-11 place-items-center rounded-xl border border-[#75d5b2]/20 bg-[#75d5b2]/[.07]"><UploadCloud className="size-5 text-[#78d7b5]" /></span><p className="mt-7 text-[9px] font-semibold uppercase tracking-[.18em] text-[#777e89]">Step 2 · Irreversible close</p><h2 className="mt-3 text-2xl font-medium tracking-[-.04em]">Upload the signed agreement</h2><p className="mt-4 text-xs leading-6 text-[#777e89]">Sign the downloaded copy and upload it here as a PDF. Maximum file size: 15 MB.</p><label className="mt-7 block cursor-pointer rounded-xl border border-dashed border-white/[.16] bg-white/[.025] p-5 text-center hover:border-[#8e91ff]/50"><input required name="contract" type="file" accept="application/pdf,.pdf" className="block w-full text-[10px] text-[#777e89] file:mr-3 file:rounded-lg file:border-0 file:bg-white/[.09] file:px-3 file:py-2 file:text-[10px] file:text-white" /></label><label className="mt-5 flex items-start gap-3 text-[10px] leading-5 text-[#858b95]"><input required checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} type="checkbox" className="mt-0.5 size-4 accent-[#8588ff]" />I confirm that the file contains the required signatures and understand that this upload permanently closes the record without allowing replacement or changes.</label></div><button disabled={busy || !confirmed} className="flex h-14 w-full items-center justify-center gap-3 border-t border-white/[.08] bg-[#7d80ee] text-xs font-semibold text-white transition hover:bg-[#898cf7] disabled:bg-white/[.04] disabled:text-[#585e68]">{busy ? "Securing record..." : "Upload and close record"}<LockKeyhole className="size-4" /></button></form></div>;
}

function LockedState({ agreement }: { agreement: AgreementState }) {
  const uploaded = agreement.signedUploadedAt ? new Date(agreement.signedUploadedAt).toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" }) : "";
  return <section className="relative mt-14 overflow-hidden rounded-3xl border border-[#75d5b2]/20 bg-[#0d1214] px-6 py-14 text-center sm:px-12 sm:py-20"><div className="absolute inset-0 opacity-30 [background-image:radial-gradient(circle_at_50%_20%,rgba(78,214,169,.22),transparent_35%)]"/><div className="relative"><span className="mx-auto grid size-16 place-items-center rounded-full border border-[#7cdbb9]/30 bg-[#7cdbb9]/10 shadow-[0_0_60px_rgba(93,211,169,.12)]"><FileCheck2 className="size-7 text-[#7edaba]" /></span><p className="mt-7 text-[9px] font-semibold uppercase tracking-[.22em] text-[#76d3b2]">Record closed</p><h2 className="mt-4 text-3xl font-medium tracking-[-.045em] sm:text-4xl">Agreement received and secured</h2><p className="mx-auto mt-5 max-w-xl text-sm leading-7 text-[#7c838d]">ORBIT stored the signed copy for {agreement.merchant.businessName}{uploaded ? ` on ${uploaded}` : ""}. To preserve document integrity, this link no longer permits editing, downloading, replacing or uploading files.</p><div className="mx-auto mt-8 flex max-w-md items-center justify-center gap-3 rounded-xl border border-white/[.07] bg-black/20 px-4 py-3 font-mono text-[9px] text-[#696f79]"><ShieldCheck className="size-4 text-[#7edaba]" />{agreement.signedOriginalName ?? "Verified signed agreement"}</div></div></section>;
}

function LoadingState() { return <div className="mx-auto mt-20 max-w-2xl text-center"><div className="mx-auto size-10 animate-spin rounded-full border border-white/[.08] border-t-[#8b8eff]"/><p className="mt-5 text-xs text-[#676e78]">Opening secure record...</p></div>; }
function UnavailableState({ message }: { message: string }) { return <div className="mx-auto mt-20 max-w-xl rounded-2xl border border-white/[.08] bg-[#0d1015] p-10 text-center"><LockKeyhole className="mx-auto size-7 text-[#727986]"/><h1 className="mt-5 text-2xl font-medium tracking-[-.04em]">Invitation unavailable</h1><p className="mt-3 text-sm leading-6 text-[#747b86]">{message}</p></div>; }
