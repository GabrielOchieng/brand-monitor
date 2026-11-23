"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "../../lib/api";
import { AdminShell, AdminTable, StatCard, ago, day, td, useAdminData } from "../../components/admin/AdminShell";

interface Overview {
  month: string;
  totals: { orgs: number; users: number; brands: number; scansThisMonth: number; emailsThisMonth: number; tavilyThisMonth: number; tavilyCap: number };
  orgs: Array<{
    id: string;
    name: string;
    createdAt: string;
    members: number;
    brands: number;
    findings: number;
    scansThisMonth: number;
    emailsThisMonth: number;
    lastActiveAt: string | null;
  }>;
}

function CreateOrg() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const org = await apiFetch<{ id: string }>("/api/admin/orgs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      router.push(`/admin/orgs/${org.id}?created=1`);
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  if (!open)
    return (
      <button className="btn-primary" onClick={() => setOpen(true)}>
        New organization
      </button>
    );
  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <input autoFocus required maxLength={100} placeholder="Organization name" value={name} onChange={(e) => setName(e.target.value)} className="field" />
      <button type="submit" disabled={busy} className="btn-primary">
        {busy ? "Creating…" : "Create"}
      </button>
      <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
        Cancel
      </button>
      {error && <p className="w-full text-sm text-red-600">{error}</p>}
    </form>
  );
}

export default function AdminOrgsPage() {
  const { data, blocked, error } = useAdminData<Overview>("/api/admin/overview");
  const t = data?.totals;
  return (
    <AdminShell title="Organizations" actions={<CreateOrg />} blocked={blocked} error={error} loading={!data && !error}>
      {data && t && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatCard label="Organizations" value={t.orgs} />
            <StatCard label="Users" value={t.users} />
            <StatCard label="Brands" value={t.brands} hint="all monitored" />
            <StatCard label="Scans" value={t.scansThisMonth.toLocaleString()} hint={`in ${data.month}`} />
            <StatCard label="Alert emails" value={t.emailsThisMonth} hint={`sent in ${data.month}`} />
            <StatCard label="Tavily searches" value={`${t.tavilyThisMonth} / ${t.tavilyCap}`} hint={`in ${data.month}, all brands`} />
          </div>
          <AdminTable head={["Organization", "Members", "Brands", "Findings", "Scans this month", "Emails this month", "Last active", "Created"]}>
            {data.orgs.map((o) => (
              <tr key={o.id} className="hover:bg-elevated/50">
                <td className="whitespace-nowrap px-4 py-2.5">
                  <Link href={`/admin/orgs/${o.id}`} className="font-medium text-ink hover:text-brand">
                    {o.name}
                  </Link>
                </td>
                <td className={td}>{o.members}</td>
                <td className={td}>{o.brands}</td>
                <td className={td}>{o.findings.toLocaleString()}</td>
                <td className={td}>{o.scansThisMonth.toLocaleString()}</td>
                <td className={td}>{o.emailsThisMonth}</td>
                <td className={td}>{ago(o.lastActiveAt)}</td>
                <td className={td}>{day(o.createdAt)}</td>
              </tr>
            ))}
          </AdminTable>
          <p className="text-xs text-ink-subtle">
            Last active: the most recent sign-in activity of any member. Scans and emails count this calendar month (UTC). Tavily usage per brand comes in a later version.
          </p>
        </>
      )}
    </AdminShell>
  );
}
