"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@clerk/nextjs";
import { apiFetch, API_URL } from "../../lib/api";
import { BrandKeywords } from "../../components/BrandKeywords";
import { BrandOfficialAccounts } from "../../components/BrandOfficialAccounts";
import { SettingsSkeleton } from "../../components/PageSkeletons";
import { ChevronDownIcon, ImageIcon, PlusIcon, TrashIcon } from "../../components/icons";
import { pickBrand, writeSelectedBrand } from "../../lib/selectedBrand";

interface Brand {
  id: string;
  name: string;
  primaryDomain: string;
}

// Everything about a brand that isn't day-to-day triage: its details, discovery keywords,
// official accounts and apps, and deletion. Used to be toggles on the dashboard.
export default function SettingsPage() {
  const { getToken, isLoaded, orgId } = useAuth();
  const [brands, setBrands] = useState<Brand[] | null>(null);
  const [brandId, setBrandId] = useState<string | null>(null);
  const [hasVisualBaseline, setHasVisualBaseline] = useState(false);
  const [details, setDetails] = useState({ name: "", primaryDomain: "" });
  const [savingDetails, setSavingDetails] = useState(false);
  const [detailsSaved, setDetailsSaved] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newBrand, setNewBrand] = useState({ name: "", primaryDomain: "", concatKeywords: "" });
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadBrands = useCallback(
    async (prefer?: string) => {
      const list = await apiFetch<Brand[]>("/api/brands", await getToken());
      setBrands(list);
      const chosen = list.find((b) => b.id === prefer) ?? pickBrand(list);
      setBrandId(chosen?.id ?? null);
    },
    [getToken]
  );

  useEffect(() => {
    if (!isLoaded || !orgId) return;
    loadBrands().catch((err) => {
      setError(err.message);
      setBrands([]);
    });
  }, [isLoaded, orgId, loadBrands]);

  const brand = brands?.find((b) => b.id === brandId) ?? null;

  useEffect(() => {
    if (!brand) return;
    setDetails({ name: brand.name, primaryDomain: brand.primaryDomain });
    setDetailsSaved(false);
    (async () => {
      try {
        const s = await apiFetch<{ brand: { hasVisualBaseline: boolean } }>(`/api/dashboard/summary?brandId=${brand.id}`, await getToken());
        setHasVisualBaseline(s.brand.hasVisualBaseline);
      } catch {
        setHasVisualBaseline(false);
      }
    })();
  }, [brand, getToken]);

  function selectBrand(id: string) {
    writeSelectedBrand(id);
    setBrandId(id);
  }

  async function saveDetails(e: React.FormEvent) {
    e.preventDefault();
    if (!brand) return;
    setSavingDetails(true);
    setError(null);
    try {
      await apiFetch(`/api/brands/${brand.id}`, await getToken(), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(details),
      });
      await loadBrands(brand.id);
      setDetailsSaved(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingDetails(false);
    }
  }

  async function createBrand(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const created = await apiFetch<Brand>("/api/brands", await getToken(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newBrand.name,
          primaryDomain: newBrand.primaryDomain,
          concatKeywords: newBrand.concatKeywords.split(",").map((k) => k.trim()).filter(Boolean),
        }),
      });
      setNewBrand({ name: "", primaryDomain: "", concatKeywords: "" });
      setShowAdd(false);
      writeSelectedBrand(created.id);
      await loadBrands(created.id);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  async function deleteBrand() {
    if (!brand) return;
    const typed = window.prompt(`This deletes ${brand.name} and everything under it: findings, scans, notes and takedowns. It can't be undone.\n\nType the brand name to confirm.`);
    if (typed?.trim() !== brand.name) return;
    setDeleting(true);
    setError(null);
    try {
      await apiFetch(`/api/brands/${brand.id}`, await getToken(), { method: "DELETE" });
      await loadBrands();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDeleting(false);
    }
  }

  if (!isLoaded || brands === null) return <SettingsSkeleton />;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Settings</h1>
          <p className="mt-1 text-sm text-ink-subtle">What each brand is monitored for. Changes apply from the next scheduled run.</p>
        </div>
        <div className="flex items-center gap-2">
          {brands.length > 1 && (
            <div className="relative">
              <select value={brandId ?? ""} onChange={(e) => selectBrand(e.target.value)} className="field appearance-none py-1.5 pr-8 font-medium" aria-label="Brand">
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              <ChevronDownIcon className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
            </div>
          )}
          <button onClick={() => setShowAdd((v) => !v)} className="btn-secondary">
            <PlusIcon className="h-4 w-4" /> Add brand
          </button>
        </div>
      </div>

      {showAdd && (
        <form onSubmit={createBrand} className="card mt-6 grid gap-3 p-5 sm:grid-cols-[1fr_1fr_1.5fr_auto] sm:items-end">
          <Field label="Brand name">
            <input required value={newBrand.name} onChange={(e) => setNewBrand({ ...newBrand, name: e.target.value })} className="field w-full" placeholder="Jambojet" />
          </Field>
          <Field label="Primary domain">
            <input required value={newBrand.primaryDomain} onChange={(e) => setNewBrand({ ...newBrand, primaryDomain: e.target.value })} className="field w-full" placeholder="jambojet.com" />
          </Field>
          <Field label="Keywords (optional)">
            <input value={newBrand.concatKeywords} onChange={(e) => setNewBrand({ ...newBrand, concatKeywords: e.target.value })} className="field w-full" placeholder="book, checkin, login" />
          </Field>
          <button type="submit" disabled={creating} className="btn-primary">
            {creating ? "Creating…" : "Create"}
          </button>
        </form>
      )}

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {!brand ? (
        <p className="mt-8 text-sm text-ink-subtle">No brands yet. Add one to start monitoring.</p>
      ) : (
        <div className="mt-8 space-y-8">
          <Section title="Brand details" description="The name and domain discovery builds lookalikes from.">
            <form onSubmit={saveDetails} className="grid gap-3 sm:grid-cols-2">
              <Field label="Name">
                <input required value={details.name} onChange={(e) => setDetails({ ...details, name: e.target.value })} className="field w-full" />
              </Field>
              <Field label="Primary domain">
                <input required value={details.primaryDomain} onChange={(e) => setDetails({ ...details, primaryDomain: e.target.value })} className="field w-full" />
              </Field>
              <div className="flex items-center gap-3 sm:col-span-2">
                <button
                  type="submit"
                  disabled={savingDetails || (details.name === brand.name && details.primaryDomain === brand.primaryDomain)}
                  className="btn-primary"
                >
                  {savingDetails ? "Saving…" : "Save changes"}
                </button>
                {detailsSaved && <span className="text-xs text-emerald-700">Saved</span>}
              </div>
            </form>
          </Section>

          <Section
            title="Discovery keywords"
            description={`Combined with the brand name to find lookalikes a typo check misses: "book" gives book${brand.primaryDomain}. Click a keyword to pair it with the other paired ones ("fly" + "book" gives flybook${brand.primaryDomain.split(".")[0]}.xyz); up to 8 paired.`}
          >
            <BrandKeywords brandId={brand.id} />
          </Section>

          <Section
            title="Official accounts and apps"
            description="The brand's real social accounts, WhatsApp link and App Store / Google Play apps. The searches skip these; accounts or apps named like the brand that aren't listed are flagged."
          >
            <BrandOfficialAccounts brandId={brand.id} />
          </Section>

          <Section title="Visual reference" description="The screenshot of the brand's real site that pages are compared against to spot clones.">
            {hasVisualBaseline ? (
              <a href={`${API_URL}/screenshots/brand-${brand.id}.png`} target="_blank" rel="noreferrer" className="btn-secondary">
                <ImageIcon className="h-4 w-4" /> View reference screenshot
              </a>
            ) : (
              <p className="text-sm text-ink-subtle">Not captured yet. It&apos;s taken automatically on the next scan of a finding.</p>
            )}
          </Section>

          <Section title="Delete brand" description="Removes the brand and all its findings, scans, notes and takedown records." danger>
            <button onClick={deleteBrand} disabled={deleting} className="btn border border-red-200 bg-white px-3.5 py-2 text-red-600 hover:bg-red-50">
              <TrashIcon className="h-4 w-4" /> {deleting ? "Deleting…" : `Delete ${brand.name}`}
            </button>
          </Section>
        </div>
      )}
    </div>
  );
}

function Section({ title, description, danger, children }: { title: string; description: string; danger?: boolean; children: ReactNode }) {
  return (
    <section className={`grid gap-4 border-t pt-8 first:border-t-0 first:pt-0 lg:grid-cols-[18rem_1fr] lg:gap-10 ${danger ? "border-red-100" : "border-line"}`}>
      <div>
        <h2 className={`text-sm font-semibold ${danger ? "text-red-700" : "text-ink"}`}>{title}</h2>
        <p className="mt-1 text-xs leading-relaxed text-ink-subtle">{description}</p>
      </div>
      <div className="card p-5">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label mb-1">{label}</span>
      {children}
    </label>
  );
}
