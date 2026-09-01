"use client";

import { Building2, Check, LockKeyhole, Pencil, Plus, RefreshCw, UserRound, WalletCards, X } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { sentinelFetch } from "./client";

type MerchantOption = { id: string; businessName: string; hostname?: string | null; portalEnabled: boolean };
type WorkspaceUser = {
  id: string; email: string; name?: string; role: string; portalAllMerchants: boolean; active: boolean; lastLoginAt?: string; createdAt: string;
  merchantAccess: Array<{ id: string; businessName: string; canInitiatePayouts: boolean }>;
};

export function UserManagement({ currentRole }: { currentRole: string }) {
  const [users, setUsers] = useState<WorkspaceUser[]>([]);
  const [merchants, setMerchants] = useState<MerchantOption[]>([]);
  const [role, setRole] = useState("VIEWER");
  const [portalAllMerchants, setPortalAllMerchants] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingUserId, setEditingUserId] = useState("");
  const [editingMerchantIds, setEditingMerchantIds] = useState<string[]>([]);
  const [editingPayoutMerchantIds, setEditingPayoutMerchantIds] = useState<string[]>([]);
  const [editingAllMerchants, setEditingAllMerchants] = useState(false);
  const [savingAccess, setSavingAccess] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await sentinelFetch<{ users: WorkspaceUser[]; merchants: MerchantOption[] }>("/api/sentinel/users");
      setUsers(data.users); setMerchants(data.merchants); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load users"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    let active = true;
    sentinelFetch<{ users: WorkspaceUser[]; merchants: MerchantOption[] }>("/api/sentinel/users")
      .then((data) => { if (active) { setUsers(data.users); setMerchants(data.merchants); setError(""); } })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "Unable to load users"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = event.currentTarget; const data = new FormData(form);
    const payload = {
      name: data.get("name"), email: data.get("email"), password: data.get("password"), role: data.get("role"), portalAllMerchants,
      merchantIds: data.getAll("merchantIds"), payoutMerchantIds: data.getAll("payoutMerchantIds"),
    };
    try {
      await sentinelFetch("/api/sentinel/users", { method: "POST", body: JSON.stringify(payload) });
      form.reset(); setRole("VIEWER"); setPortalAllMerchants(false); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to add user"); }
    finally { setBusy(false); }
  }

  function startEditing(user: WorkspaceUser) {
    setEditingUserId(user.id);
    setEditingMerchantIds(user.merchantAccess.map((merchant) => merchant.id));
    setEditingPayoutMerchantIds(user.merchantAccess.filter((merchant) => merchant.canInitiatePayouts).map((merchant) => merchant.id));
    setEditingAllMerchants(user.portalAllMerchants);
    setError("");
  }

  function toggleMerchant(merchantId: string) {
    setEditingMerchantIds((current) => {
      if (current.includes(merchantId)) {
        setEditingPayoutMerchantIds((payouts) => payouts.filter((id) => id !== merchantId));
        return current.filter((id) => id !== merchantId);
      }
      return [...current, merchantId];
    });
  }

  function togglePayoutMerchant(merchantId: string) {
    setEditingPayoutMerchantIds((current) => current.includes(merchantId) ? current.filter((id) => id !== merchantId) : [...current, merchantId]);
  }

  async function saveAccess() {
    if (!editingUserId) return;
    setSavingAccess(true); setError("");
    try {
      await sentinelFetch("/api/sentinel/users", { method: "PATCH", body: JSON.stringify({
        userId: editingUserId, portalAllMerchants: editingAllMerchants, merchantIds: editingMerchantIds, payoutMerchantIds: editingPayoutMerchantIds,
      }) });
      setEditingUserId(""); setEditingMerchantIds([]); setEditingPayoutMerchantIds([]); setEditingAllMerchants(false); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to update merchant access"); }
    finally { setSavingAccess(false); }
  }

  return <div className="mx-auto max-w-[1240px] px-4 py-8 sm:px-7 lg:px-10">
    <header className="border-b border-white/[.07] pb-6"><p className="text-[9px] font-semibold uppercase text-[#8f82ef]">Workspace administration</p><h1 className="mt-2 text-2xl font-medium">Users & access</h1><p className="mt-2 max-w-2xl text-xs leading-5 text-[#72767f]">Choose the brands each person can see and, separately, the brands where they can transfer available balance. Every new client starts read-only.</p></header>
    {error && <p className="mt-5 border border-[#d17777]/20 bg-[#d17777]/5 p-3 text-[10px] text-[#d99595]">{error}</p>}
    <div className="mt-7 grid gap-8 lg:grid-cols-[1fr_390px]">
      <section><div className="flex items-center justify-between"><h2 className="text-sm font-medium">Workspace users</h2><button onClick={() => void load()} aria-label="Refresh users" className="grid size-8 place-items-center rounded border border-white/[.08] text-[#777b84]"><RefreshCw className="size-3.5" /></button></div><div className="mt-3 border border-white/[.075] bg-[#0c0e12]">
        {loading ? <div className="h-40 animate-pulse bg-white/[.025]" /> : users.map((user) => {
          const canEditFinancial = user.role !== "OWNER" && (user.role !== "ADMIN" || currentRole === "OWNER");
          const editing = editingUserId === user.id;
          const payoutCount = user.role === "OWNER" || user.role === "ADMIN" ? merchants.length : user.merchantAccess.filter((merchant) => merchant.canInitiatePayouts).length;
          return <div key={user.id} className="border-b border-white/[.06] last:border-0"><div className="grid gap-3 p-4 sm:grid-cols-[minmax(180px,1fr)_90px_minmax(190px,1fr)_auto] sm:items-center"><div className="flex items-center gap-3"><span className="grid size-8 shrink-0 place-items-center rounded-full bg-white/[.045]"><UserRound className="size-3.5 text-[#858991]" /></span><span className="min-w-0"><span className="block truncate text-xs text-[#d0d2cd]">{user.name}</span><span className="mt-0.5 block truncate text-[10px] text-[#62666f]">{user.email}</span></span></div><span className="w-fit rounded border border-white/[.08] px-2 py-1 text-[9px] text-[#8d9199]">{user.role}</span><div><p className="flex items-center gap-1.5 text-[9px] text-[#767a82]"><Building2 className="size-3 shrink-0" />{user.portalAllMerchants ? "All financial brands" : user.merchantAccess.length ? user.merchantAccess.map((merchant) => merchant.businessName).join(", ") : "No financial access"}</p><p className="mt-1 flex items-center gap-1.5 text-[9px] text-[#7770b4]"><WalletCards className="size-3" />{payoutCount ? `Transfers enabled on ${payoutCount} brand${payoutCount === 1 ? "" : "s"}` : "Read-only · no transfers"}</p></div>{canEditFinancial ? <button onClick={() => editing ? setEditingUserId("") : startEditing(user)} className="inline-flex h-8 items-center gap-1.5 rounded border border-white/[.09] px-2.5 text-[9px] text-[#8d9199] hover:text-white">{editing ? <X className="size-3" /> : <Pencil className="size-3" />}{editing ? "Cancel" : "Permissions"}</button> : <span className="text-[8px] text-[#565a63]">Always all</span>}</div>
            {editing && <div className="border-t border-white/[.055] bg-black/10 px-4 py-4"><div className="flex flex-col gap-3 sm:flex-row"><button type="button" onClick={() => setEditingAllMerchants(true)} className={`flex-1 rounded-md border p-3 text-left ${editingAllMerchants ? "border-[#7779ea]/35 bg-[#7779ea]/[.07]" : "border-white/[.07]"}`}><span className="text-[10px] text-[#d0d2cd]">All brands</span><span className="mt-1 block text-[8px] text-[#62666e]">Can see the complete financial portfolio.</span></button><button type="button" onClick={() => setEditingAllMerchants(false)} className={`flex-1 rounded-md border p-3 text-left ${!editingAllMerchants ? "border-[#7779ea]/35 bg-[#7779ea]/[.07]" : "border-white/[.07]"}`}><span className="text-[10px] text-[#d0d2cd]">Selected brands only</span><span className="mt-1 block text-[8px] text-[#62666e]">Can see only checked brands.</span></button></div><div className="mt-4 flex items-center gap-2 text-[9px] font-semibold uppercase text-[#696d76]"><LockKeyhole className="size-3 text-[#8f82ef]" />Brand permissions</div><div className="mt-3 grid gap-2 sm:grid-cols-2">{merchants.map((merchant) => { const visible = editingAllMerchants || editingMerchantIds.includes(merchant.id); const payout = editingPayoutMerchantIds.includes(merchant.id); return <div key={merchant.id} className={`rounded-md border p-3 ${visible ? "border-[#7779ea]/30 bg-[#7779ea]/[.06]" : "border-white/[.07] bg-white/[.015]"}`}><button type="button" onClick={() => !editingAllMerchants && toggleMerchant(merchant.id)} className="flex w-full items-center gap-3 text-left"><span className={`grid size-4 shrink-0 place-items-center rounded border ${visible ? "border-[#8588ef] bg-[#7779ea] text-white" : "border-white/[.14]"}`}>{visible && <Check className="size-2.5" />}</span><span className="min-w-0 flex-1"><span className="block truncate text-[10px] text-[#c2c4bf]">{merchant.businessName}</span><span className={`mt-1 block text-[8px] ${merchant.portalEnabled ? "text-[#6fc39d]" : "text-[#62666e]"}`}>{merchant.portalEnabled ? "Portal activated" : "Portal not activated"}</span></span></button><button type="button" disabled={!visible} onClick={() => togglePayoutMerchant(merchant.id)} className={`mt-3 flex w-full items-center justify-between rounded border px-2.5 py-2 text-[8px] disabled:opacity-30 ${payout ? "border-[#8f82ef]/35 bg-[#8f82ef]/10 text-[#c9c5ff]" : "border-white/[.07] text-[#686d76]"}`}><span className="flex items-center gap-1.5"><WalletCards className="size-3" />Can transfer balance</span><span className={`h-3.5 w-6 rounded-full p-0.5 ${payout ? "bg-[#7868e8]" : "bg-white/[.08]"}`}><span className={`block size-2.5 rounded-full bg-white transition ${payout ? "translate-x-2.5" : ""}`} /></span></button></div>; })}</div><div className="mt-4 flex items-center justify-between gap-3"><p className="text-[9px] text-[#555a62]">Changes apply on the next page request.</p><button onClick={() => void saveAccess()} disabled={savingAccess} className="h-8 rounded bg-[#e9eae6] px-3 text-[9px] font-medium text-black disabled:opacity-40">{savingAccess ? "Saving…" : "Save permissions"}</button></div></div>}
          </div>;
        })}
      </div></section>
      <aside><h2 className="text-sm font-medium">Create client access</h2><form onSubmit={submit} className="mt-3 space-y-4 border border-white/[.075] bg-[#0c0e12] p-5">
        {[["name", "Name", "Alex Morgan", "text"], ["email", "Work email", "alex@company.com", "email"], ["password", "Temporary password", "Minimum 12 characters", "password"]].map(([name, label, placeholder, type]) => <label key={name} className="block text-[10px] text-[#7f838b]">{label}<input required minLength={name === "password" ? 12 : 2} name={name} type={type} placeholder={placeholder} className="mt-1.5 h-10 w-full rounded-md border border-white/[.1] bg-white/[.025] px-3 text-xs text-white outline-none focus:border-[#7779ea]" /></label>)}
        <label className="block text-[10px] text-[#7f838b]">Workspace role<select name="role" value={role} onChange={(event) => setRole(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-white/[.1] bg-[#0e1014] px-3 text-xs text-white outline-none"><option value="VIEWER">Viewer</option><option value="REVIEWER">Merchant manager</option><option value="ANALYST">Analyst</option>{currentRole === "OWNER" && <option value="ADMIN">Administrator</option>}</select></label>
        <fieldset><legend className="text-[10px] text-[#7f838b]">Financial portal access</legend><div className="mt-2 grid grid-cols-2 gap-2"><button type="button" onClick={() => setPortalAllMerchants(false)} className={`rounded-md border p-3 text-left text-[9px] ${!portalAllMerchants ? "border-[#7779ea]/35 bg-[#7779ea]/[.07] text-[#c9c5ff]" : "border-white/[.08] text-[#777b84]"}`}>Selected brands</button><button type="button" onClick={() => setPortalAllMerchants(true)} className={`rounded-md border p-3 text-left text-[9px] ${portalAllMerchants ? "border-[#7779ea]/35 bg-[#7779ea]/[.07] text-[#c9c5ff]" : "border-white/[.08] text-[#777b84]"}`}>All brands</button></div></fieldset>
        <fieldset><legend className="text-[10px] text-[#7f838b]">Brand permissions</legend><div className="mt-1.5 max-h-56 overflow-y-auto rounded-md border border-white/[.1] bg-black/10 p-2">{merchants.length ? merchants.map((merchant) => <div key={merchant.id} className="grid grid-cols-[1fr_auto] items-center gap-2 rounded px-2 py-2.5 hover:bg-white/[.025]"><label className="flex cursor-pointer items-center gap-3"><input name="merchantIds" value={merchant.id} type="checkbox" defaultChecked={portalAllMerchants} disabled={portalAllMerchants} className="size-3.5 accent-[#7779ea]" /><span className="min-w-0"><span className="block truncate text-[10px] text-[#c2c4bf]">{merchant.businessName}</span><span className={`mt-0.5 block truncate text-[9px] ${merchant.portalEnabled ? "text-[#6fc39d]" : "text-[#555a62]"}`}>{merchant.portalEnabled ? "Portal activated" : merchant.hostname ?? "Portal not activated"}</span></span></label><label className="flex cursor-pointer items-center gap-1.5 rounded border border-white/[.07] px-2 py-1.5 text-[8px] text-[#8f82ef]"><input name="payoutMerchantIds" value={merchant.id} type="checkbox" className="size-3 accent-[#7779ea]" /><WalletCards className="size-3" />Transfer</label></div>) : <p className="p-2 text-[10px] leading-4 text-[#5e626a]">Create a merchant before adding financial access.</p>}</div><p className="mt-2 text-[9px] leading-4 text-[#555a62]">For selected-brand access, enable visibility before transfer permission. New users are read-only by default.</p></fieldset>
        <button disabled={busy} className="flex h-9 w-full items-center justify-center gap-2 rounded-md bg-[#e9eae6] text-[10px] font-medium text-black disabled:opacity-50"><Plus className="size-3" />{busy ? "Creating…" : "Create access"}</button><p className="text-[9px] leading-4 text-[#555a62]">Workspace roles, visible brands and money movement permissions are controlled independently.</p>
      </form></aside>
    </div>
  </div>;
}
