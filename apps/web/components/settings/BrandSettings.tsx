"use client";

import { useEffect, useState } from "react";
import { apiFetch, API_URL } from "../../lib/api";
import { BrandKeywords } from "../BrandKeywords";
import { BrandOfficialAccounts } from "../BrandOfficialAccounts";
import { ImageIcon, TrashIcon } from "../icons";
import { Skeleton } from "../Skeleton";
import { Field, Section } from "./Section";
import { ReportLink } from "./ReportLink";

export interface Brand {
  id: string;
  name: string;
  primaryDomain: string;
  reportToken: string | null;
}

// Mirrors the API's DomainSchema (routes/brands.ts) for instant feedback: a pasted URL is
// trimmed to its bare domain, anything else that isn't a domain is flagged before saving.
export function cleanDomain(input: string): string {
  return input.trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/[/?#].*$/, "").replace(/^www\./, "").replace(/\.$/, "");
}
export function domainError(input: string): string | null {
  if (!input.trim()) return "Required.";
  return /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(cleanDomain(input)) ? null : "Use the bare domain, like jambojet.com.";
}

export function BrandDetails({ brand, editable, onSaved }: { brand: Brand; editable: boolean; onSaved: () => Promise<void> }) {
  const [details, setDetails] = useState({ name: brand.name, primaryDomain: brand.primaryDomain });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDetails({ name: brand.name, primaryDomain: brand.primaryDomain });
    setSaved(false);
  }, [brand.id, brand.name, brand.primaryDomain]);

  const domainProblem = details.primaryDomain ? domainError(details.primaryDomain) : null;
  const dirty = details.name.trim() !== brand.name || cleanDomain(details.primaryDomain) !== brand.primaryDomain;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (domainProblem) return;
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/api/brands/${brand.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: details.name.trim(), primaryDomain: cleanDomain(details.primaryDomain) }),
      });
      await onSaved();
      setSaved(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section title="Brand details" description="The name and domain discovery builds lookalikes from. A pasted link is trimmed to its domain.">
      <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <input required disabled={!editable} value={details.name} onChange={(e) => setDetails({ ...details, name: e.target.value })} className="field w-full disabled:bg-raised/60" />
        </Field>
        <Field label="Primary domain" error={domainProblem}>
          <input
            required
            disabled={!editable}
            value={details.primaryDomain}
            onChange={(e) => setDetails({ ...details, primaryDomain: e.target.value })}
            className="field w-full disabled:bg-raised/60"
          />
        </Field>
        {editable && (
          <div className="flex items-center gap-3 sm:col-span-2">
            <button type="submit" disabled={saving || !dirty || Boolean(domainProblem)} className="btn-primary">
              {saving ? "Saving…" : "Save changes"}
            </button>
            {dirty && !saving && (
              <button type="button" onClick={() => setDetails({ name: brand.name, primaryDomain: brand.primaryDomain })} className="btn-ghost text-xs">
                Discard
              </button>
            )}
            {saved && !dirty && <span className="text-xs text-ok">Saved</span>}
          </div>
        )}
      </form>
      {error && <p className="mt-3 text-sm text-sev-critical">{error}</p>}
    </Section>
  );
}

export function KeywordsSection({ brand, editable }: { brand: Brand; editable: boolean }) {
  return (
    <Section
      title="Discovery keywords"
      description={
        <>
          Combined with the brand name to find lookalikes a typo check misses. Switch a keyword to <em>paired</em> to also combine it with the other paired ones (up to 8).
        </>
      }
    >
      <BrandKeywords brandId={brand.id} brandRoot={brand.primaryDomain.split(".")[0]} editable={editable} />
    </Section>
  );
}

export function AccountsSection({ brand, editable }: { brand: Brand; editable: boolean }) {
  return (
    <Section
      title="Official accounts and apps"
      description="The brand's real social accounts, WhatsApp link and App Store / Google Play apps. The searches skip these; anything named like the brand that isn't listed is flagged."
    >
      <BrandOfficialAccounts brandId={brand.id} editable={editable} />
    </Section>
  );
}

export function ReportFormSection({ brand, editable, onChange }: { brand: Brand; editable: boolean; onChange: (token: string | null) => void }) {
  return (
    <Section
      title="Public report form"
      description="A link customers and staff can use to report a scam without signing in. Reports appear under Reports; links in them are scanned automatically."
    >
      <ReportLink brandId={brand.id} token={brand.reportToken} editable={editable} onChange={onChange} />
    </Section>
  );
}

export function VisualReferenceSection({ brand }: { brand: Brand }) {
  const [has, setHas] = useState<boolean | null>(null);

  useEffect(() => {
    setHas(null);
    (async () => {
      try {
        const s = await apiFetch<{ brand: { hasVisualBaseline: boolean } }>(`/api/dashboard/summary?brandId=${brand.id}`);
        setHas(s.brand.hasVisualBaseline);
      } catch {
        setHas(false);
      }
    })();
  }, [brand.id]);

  return (
    <Section title="Visual reference" description="The screenshot of the brand's real site that pages are compared against to spot clones.">
      {has === null ? (
        <Skeleton className="h-9 w-56" />
      ) : has ? (
        <div>
          <a href={`${API_URL}/screenshots/brand-${brand.id}.png`} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-md border border-border">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`${API_URL}/screenshots/brand-${brand.id}.png`} alt={`Reference screenshot of ${brand.primaryDomain}`} className="w-full" />
          </a>
          <a href={`${API_URL}/screenshots/brand-${brand.id}.png`} target="_blank" rel="noreferrer" className="btn-ghost mt-2 px-0 text-xs">
            <ImageIcon className="h-3.5 w-3.5" /> Open full size
          </a>
        </div>
      ) : (
        <p className="text-sm text-subtle">Not captured yet. It&apos;s taken automatically on the next scan of a finding.</p>
      )}
    </Section>
  );
}

export function DeleteBrandSection({ brand, onDeleted }: { brand: Brand; onDeleted: () => Promise<void> }) {
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setDeleting(true);
    setError(null);
    try {
      await apiFetch(`/api/brands/${brand.id}`, { method: "DELETE" });
      await onDeleted();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Section title="Delete brand" description="Removes the brand and all its findings, scans, notes and takedown records. This can't be undone." danger>
      <Field label={`Type ${brand.name} to confirm`}>
        <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} className="field w-full max-w-sm" placeholder={brand.name} autoComplete="off" />
      </Field>
      <button
        onClick={remove}
        disabled={deleting || confirmText.trim() !== brand.name}
        className="btn mt-4 border border-sev-critical/40 bg-card px-3.5 py-2 text-sev-critical hover:bg-sev-critical/10"
      >
        <TrashIcon className="h-4 w-4" /> {deleting ? "Deleting…" : `Delete ${brand.name}`}
      </button>
      {error && <p className="mt-3 text-sm text-sev-critical">{error}</p>}
    </Section>
  );
}

export function AddBrandSection({ onCreated }: { onCreated: (id: string) => Promise<void> }) {
  const [form, setForm] = useState({ name: "", primaryDomain: "", concatKeywords: "" });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const domainProblem = form.primaryDomain ? domainError(form.primaryDomain) : null;

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (domainProblem) return;
    setCreating(true);
    setError(null);
    try {
      const created = await apiFetch<Brand>("/api/brands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          primaryDomain: cleanDomain(form.primaryDomain),
          concatKeywords: form.concatKeywords.split(",").map((k) => k.trim()).filter(Boolean),
        }),
      });
      await onCreated(created.id);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <Section title="Add a brand" description="Start monitoring another brand. Discovery runs for it within 4 hours, or straight away from the Overview page.">
      <form onSubmit={create} className="grid gap-4 sm:grid-cols-2">
        <Field label="Brand name">
          <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="field w-full" placeholder="Jambojet" />
        </Field>
        <Field label="Primary domain" error={domainProblem}>
          <input required value={form.primaryDomain} onChange={(e) => setForm({ ...form, primaryDomain: e.target.value })} className="field w-full" placeholder="jambojet.com" />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Keywords (optional)" hint="Comma-separated, e.g. book, checkin, login">
            <input value={form.concatKeywords} onChange={(e) => setForm({ ...form, concatKeywords: e.target.value })} className="field w-full" />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <button type="submit" disabled={creating || Boolean(domainProblem)} className="btn-primary">
            {creating ? "Creating…" : "Create brand"}
          </button>
        </div>
      </form>
      {error && <p className="mt-3 text-sm text-sev-critical">{error}</p>}
    </Section>
  );
}
