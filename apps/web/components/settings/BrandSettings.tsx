"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { apiFetch, API_URL } from "../../lib/api";
import { BrandKeywords } from "../BrandKeywords";
import { BrandOfficialAccounts } from "../BrandOfficialAccounts";
import { ChevronDownIcon, ImageIcon, PlusIcon, TrashIcon } from "../icons";
import { LoadingRegion, Skeleton, SkeletonCard } from "../Skeleton";
import { pickBrand, writeSelectedBrand } from "../../lib/selectedBrand";
import { Field, ReadOnlyNote, Section } from "./Section";
import { ReportLink } from "./ReportLink";

interface Brand {
  id: string;
  name: string;
  primaryDomain: string;
  reportToken: string | null;
}

// Mirrors the API's DomainSchema (routes/brands.ts) for instant feedback: a pasted URL is
// trimmed to its bare domain, anything else that isn't a domain is flagged before saving.
function cleanDomain(input: string): string {
  return input.trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/[/?#].*$/, "").replace(/^www\./, "").replace(/\.$/, "");
}
function domainError(input: string): string | null {
  if (!input.trim()) return "Required.";
  return /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(cleanDomain(input)) ? null : "Use the bare domain, like jambojet.com.";
}

export function BrandSettings({ editable }: { editable: boolean }) {
  const { getToken } = useAuth();
  const [brands, setBrands] = useState<Brand[] | null>(null);
  const [brandId, setBrandId] = useState<string | null>(null);
  const [hasVisualBaseline, setHasVisualBaseline] = useState<boolean | null>(null);
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
    loadBrands().catch((err) => {
      setError(err.message);
      setBrands([]);
    });
  }, [loadBrands]);

  const brand = brands?.find((b) => b.id === brandId) ?? null;

  useEffect(() => {
    if (!brand) return;
    setDetails({ name: brand.name, primaryDomain: brand.primaryDomain });
    setDetailsSaved(false);
    setHasVisualBaseline(null);
    (async () => {
      try {
        const s = await apiFetch<{ brand: { hasVisualBaseline: boolean } }>(`/api/dashboard/summary?brandId=${brand.id}`, await getToken());
        setHasVisualBaseline(s.brand.hasVisualBaseline);
      } catch {
        setHasVisualBaseline(false);
      }
    })();
    // Only when the selected brand changes, not on every list reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brand?.id]);

  function selectBrand(id: string) {
    writeSelectedBrand(id);
    setBrandId(id);
  }

  const detailsDomainError = details.primaryDomain ? domainError(details.primaryDomain) : null;
  const dirty = brand && (details.name.trim() !== brand.name || cleanDomain(details.primaryDomain) !== brand.primaryDomain);

  async function saveDetails(e: React.FormEvent) {
    e.preventDefault();
    if (!brand || detailsDomainError) return;
    setSavingDetails(true);
    setError(null);
    try {
      await apiFetch(`/api/brands/${brand.id}`, await getToken(), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: details.name.trim(), primaryDomain: cleanDomain(details.primaryDomain) }),
      });
      await loadBrands(brand.id);
      setDetailsSaved(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingDetails(false);
    }
  }

  const newDomainError = newBrand.primaryDomain ? domainError(newBrand.primaryDomain) : null;

  async function createBrand(e: React.FormEvent) {
    e.preventDefault();
    if (newDomainError) return;
    setCreating(true);
    setError(null);
    try {
      const created = await apiFetch<Brand>("/api/brands", await getToken(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newBrand.name.trim(),
          primaryDomain: cleanDomain(newBrand.primaryDomain),
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

  if (brands === null) {
    return (
      <LoadingRegion label="Loading brand settings" className="space-y-6">
        <Skeleton className="h-9 w-56" />
        <SkeletonCard lines={2} />
        <SkeletonCard lines={4} />
      </LoadingRegion>
    );
  }

  const brandRoot = brand?.primaryDomain.split(".")[0] ?? "brand";

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {brands.length > 1 ? (
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
        ) : (
          <div className="text-sm text-ink-subtle">{brand ? `${brand.name} · ${brand.primaryDomain}` : ""}</div>
        )}
        {editable && (
          <button onClick={() => setShowAdd((v) => !v)} className="btn-secondary">
            <PlusIcon className="h-4 w-4" /> Add brand
          </button>
        )}
      </div>

      {showAdd && (
        <form onSubmit={createBrand} className="card mt-4 grid gap-3 p-5 sm:grid-cols-[1fr_1fr_1.5fr_auto] sm:items-start">
          <Field label="Brand name">
            <input required value={newBrand.name} onChange={(e) => setNewBrand({ ...newBrand, name: e.target.value })} className="field w-full" placeholder="Jambojet" />
          </Field>
          <Field label="Primary domain" error={newDomainError}>
            <input required value={newBrand.primaryDomain} onChange={(e) => setNewBrand({ ...newBrand, primaryDomain: e.target.value })} className="field w-full" placeholder="jambojet.com" />
          </Field>
          <Field label="Keywords (optional)" hint="Comma-separated">
            <input value={newBrand.concatKeywords} onChange={(e) => setNewBrand({ ...newBrand, concatKeywords: e.target.value })} className="field w-full" placeholder="book, checkin, login" />
          </Field>
          <button type="submit" disabled={creating || Boolean(newDomainError)} className="btn-primary sm:mt-5">
            {creating ? "Creating…" : "Create"}
          </button>
        </form>
      )}

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {!brand ? (
        <p className="mt-8 text-sm text-ink-subtle">No brands yet. Add one to start monitoring.</p>
      ) : (
        <div className="mt-8 space-y-8">
          {!editable && <ReadOnlyNote />}

          <Section title="Brand details" description="The name and domain discovery builds lookalikes from. A pasted link is trimmed to its domain.">
            <form onSubmit={saveDetails} className="grid gap-3 sm:grid-cols-2">
              <Field label="Name">
                <input required disabled={!editable} value={details.name} onChange={(e) => setDetails({ ...details, name: e.target.value })} className="field w-full disabled:bg-elevated/60" />
              </Field>
              <Field label="Primary domain" error={detailsDomainError}>
                <input
                  required
                  disabled={!editable}
                  value={details.primaryDomain}
                  onChange={(e) => setDetails({ ...details, primaryDomain: e.target.value })}
                  className="field w-full disabled:bg-elevated/60"
                />
              </Field>
              {editable && (
                <div className="flex items-center gap-3 sm:col-span-2">
                  <button type="submit" disabled={savingDetails || !dirty || Boolean(detailsDomainError)} className="btn-primary">
                    {savingDetails ? "Saving…" : "Save changes"}
                  </button>
                  {dirty && !savingDetails && (
                    <button type="button" onClick={() => setDetails({ name: brand.name, primaryDomain: brand.primaryDomain })} className="btn-ghost text-xs">
                      Discard
                    </button>
                  )}
                  {detailsSaved && !dirty && <span className="text-xs text-emerald-700">Saved</span>}
                </div>
              )}
            </form>
          </Section>

          <Section
            title="Discovery keywords"
            description={
              <>
                Combined with the brand name to find lookalikes a typo check misses. Switch a keyword to <em>paired</em> to also combine it with the other paired ones (up to 8).
              </>
            }
          >
            <BrandKeywords brandId={brand.id} brandRoot={brandRoot} editable={editable} />
          </Section>

          <Section
            title="Official accounts and apps"
            description="The brand's real social accounts, WhatsApp link and App Store / Google Play apps. The searches skip these; anything named like the brand that isn't listed is flagged."
          >
            <BrandOfficialAccounts brandId={brand.id} editable={editable} />
          </Section>

          <Section
            title="Public report form"
            description="A link customers and staff can use to report a scam, without signing in. Reports appear under Reports; links in them are scanned automatically."
          >
            <ReportLink
              brandId={brand.id}
              token={brand.reportToken}
              editable={editable}
              onChange={(token) => setBrands((prev) => (prev ?? []).map((b) => (b.id === brand.id ? { ...b, reportToken: token } : b)))}
            />
          </Section>

          <Section title="Visual reference" description="The screenshot of the brand's real site that pages are compared against to spot clones.">
            {hasVisualBaseline === null ? (
              <Skeleton className="h-9 w-56" />
            ) : hasVisualBaseline ? (
              <a href={`${API_URL}/screenshots/brand-${brand.id}.png`} target="_blank" rel="noreferrer" className="btn-secondary">
                <ImageIcon className="h-4 w-4" /> View reference screenshot
              </a>
            ) : (
              <p className="text-sm text-ink-subtle">Not captured yet. It&apos;s taken automatically on the next scan of a finding.</p>
            )}
          </Section>

          {editable && (
            <Section title="Delete brand" description="Removes the brand and all its findings, scans, notes and takedown records." danger>
              <button onClick={deleteBrand} disabled={deleting} className="btn border border-red-200 bg-white px-3.5 py-2 text-red-600 hover:bg-red-50">
                <TrashIcon className="h-4 w-4" /> {deleting ? "Deleting…" : `Delete ${brand.name}`}
              </button>
            </Section>
          )}
        </div>
      )}
    </div>
  );
}
