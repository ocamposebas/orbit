"use client";

import { Building2, Plus, RefreshCw, UserRound } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { sentinelFetch } from "./client";

type MerchantOption = { id: string; businessName: string; hostname?: string | null };
type WorkspaceUser = { id: string; email: string; name?: string; role: string; active: boolean; lastLoginAt?: string; createdAt: string; merchantAccess: Array<{ id: string; businessName: string }> };

export function UserManagement({ currentRole }: { currentRole: string }) {
  const [users, setUsers] = useState<WorkspaceUser[]>([]);
  const [merchants, setMerchants] = useState<MerchantOption[]>([]);
  const [role, setRole] = useState("VIEWER");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
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
    const payload = { name: data.get("name"), email: data.get("email"), password: data.get("password"), role: data.get("role"), merchantIds: data.getAll("merchantIds") };
    try { await sentinelFetch("/api/sentinel/users", { method: "POST", body: JSON.stringify(payload) }); form.reset(); setRole("VIEWER"); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to add user"); }
    finally { setBusy(false); }
  }
  const scopedRole = role === "VIEWER" || role === "REVIEWER";

  return <div className="mx-auto max-w-[1240px] px-4 py-8 sm:px-7 lg:px-10">
    <header className="border-b border-white/[.07] pb-6"><p className="text-[9px] font-semibold uppercase tracking-[.16em] text-[#8083ed]">Workspace administration</p><h1 className="mt-2 text-2xl font-medium tracking-[-.04em]">Users & access</h1><p className="mt-2 max-w-xl text-xs leading-5 text-[#72767f]">Client accounts only see the merchant records explicitly assigned to them. Workspace roles retain broader operational access.</p></header>
    <div className="mt-7 grid gap-8 lg:grid-cols-[1fr_390px]">
      <section><div className="flex items-center justify-between"><h2 className="text-sm font-medium">Workspace users</h2><button onClick={() => void load()} aria-label="Refresh users" className="grid size-8 place-items-center rounded border border-white/[.08] text-[#777b84]"><RefreshCw className="size-3.5" /></button></div><div className="mt-3 border border-white/[.075] bg-[#0c0e12]">
        {loading ? <div className="h-40 animate-pulse bg-white/[.025]" /> : users.map((user) => <div key={user.id} className="grid gap-3 border-b border-white/[.06] p-4 last:border-0 sm:grid-cols-[minmax(180px,1fr)_110px_minmax(180px,1fr)] sm:items-center"><div className="flex items-center gap-3"><span className="grid size-8 shrink-0 place-items-center rounded-full bg-white/[.045]"><UserRound className="size-3.5 text-[#858991]" /></span><span className="min-w-0"><span className="block truncate text-xs text-[#d0d2cd]">{user.name}</span><span className="mt-0.5 block truncate text-[10px] text-[#62666f]">{user.email}</span></span></div><span className="w-fit rounded border border-white/[.08] px-2 py-1 text-[9px] text-[#8d9199]">{user.role}</span><div><p className="flex items-center gap-1.5 text-[9px] text-[#767a82]"><Building2 className="size-3 shrink-0" />{["OWNER", "ADMIN", "ANALYST"].includes(user.role) ? "All merchants" : user.merchantAccess.length ? user.merchantAccess.map((merchant) => merchant.businessName).join(", ") : "No merchant assigned"}</p><p className="mt-1 text-[9px] text-[#50545c]">{user.lastLoginAt ? `Last sign-in ${new Date(user.lastLoginAt).toLocaleDateString()}` : "Never signed in"}</p></div></div>)}
      </div></section>
      <aside><h2 className="text-sm font-medium">Create client access</h2><form onSubmit={submit} className="mt-3 space-y-4 border border-white/[.075] bg-[#0c0e12] p-5">
        {[["name", "Name", "Alex Morgan", "text"], ["email", "Work email", "alex@company.com", "email"], ["password", "Temporary password", "Minimum 12 characters", "password"]].map(([name, label, placeholder, type]) => <label key={name} className="block text-[10px] text-[#7f838b]">{label}<input required minLength={name === "password" ? 12 : 2} name={name} type={type} placeholder={placeholder} className="mt-1.5 h-10 w-full rounded-md border border-white/[.1] bg-white/[.025] px-3 text-xs text-white outline-none focus:border-[#7779ea]" /></label>)}
        <label className="block text-[10px] text-[#7f838b]">Role<select name="role" value={role} onChange={(event) => setRole(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-white/[.1] bg-[#0e1014] px-3 text-xs text-white outline-none"><option value="VIEWER">Viewer · report only</option><option value="REVIEWER">Reviewer · can review findings</option><option value="ANALYST">Analyst · all merchants</option>{currentRole === "OWNER" && <option value="ADMIN">Administrator</option>}</select></label>
        {scopedRole && <fieldset><legend className="text-[10px] text-[#7f838b]">Merchant access</legend><div className="mt-1.5 max-h-48 overflow-y-auto rounded-md border border-white/[.1] bg-black/10 p-2">{merchants.length ? merchants.map((merchant) => <label key={merchant.id} className="flex cursor-pointer items-center gap-3 rounded px-2 py-2.5 hover:bg-white/[.025]"><input name="merchantIds" value={merchant.id} type="checkbox" className="size-3.5 accent-[#7779ea]" /><span className="min-w-0"><span className="block truncate text-[10px] text-[#c2c4bf]">{merchant.businessName}</span>{merchant.hostname && <span className="mt-0.5 block truncate text-[9px] text-[#555a62]">{merchant.hostname}</span>}</span></label>) : <p className="p-2 text-[10px] leading-4 text-[#5e626a]">Create a merchant before adding a client account.</p>}</div><p className="mt-2 text-[9px] leading-4 text-[#555a62]">Only selected merchants will appear after sign-in.</p></fieldset>}
        {error && <p className="text-[10px] leading-4 text-[#d58b8b]">{error}</p>}<button disabled={busy || (scopedRole && merchants.length === 0)} className="flex h-9 w-full items-center justify-center gap-2 rounded-md bg-[#e9eae6] text-[10px] font-medium text-black disabled:opacity-50"><Plus className="size-3" />{busy ? "Creating…" : "Create access"}</button><p className="text-[9px] leading-4 text-[#555a62]">Share the temporary password securely. Submitting an existing email updates its role, password and merchant assignment.</p>
      </form></aside>
    </div>
  </div>;
}
