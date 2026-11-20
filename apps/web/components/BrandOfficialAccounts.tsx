"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";
import { apiFetch } from "../lib/api";
import { TrashIcon } from "./icons";
import { TargetIcon } from "./ThreatsTable";
import { LoadingRegion, Skeleton } from "./Skeleton";
import { describeTarget } from "../lib/format";

// A WhatsApp link isn't a profile, so describeTarget has no name for it.
function describeOfficial(url: string) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "wa.me" || host === "api.whatsapp.com") {
      const number = host === "wa.me" ? u.pathname.replace(/\//g, "") : u.searchParams.get("phone") ?? "";
      return { primary: `+${number.replace(/^\+/, "")}`, secondary: "WhatsApp", platform: "WhatsApp", type: "social" };
    }
  } catch {
    // fall through
  }
  const t = describeTarget(url, "social");
  return { ...t, type: "social" };
}

// The brand's real social accounts, WhatsApp link and apps. The searches never report
// these, and their contact numbers count as the brand's own.
export function BrandOfficialAccounts({ brandId, editable = true }: { brandId: string; editable?: boolean }) {
  const { getToken } = useAuth();
  const [urls, setUrls] = useState<string[] | null>(null);
  const [newUrl, setNewUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await apiFetch<{ urls: string[] }>(`/api/brands/${brandId}/official-socials`, await getToken());
    setUrls(data.urls);
  }, [getToken, brandId]);

  useEffect(() => {
    setUrls(null);
    load().catch((err) => {
      setUrls([]);
      setError(err.message);
    });
  }, [load]);

  async function save(next: string[]) {
    setSaving(true);
    setError(null);
    try {
      const data = await apiFetch<{ urls: string[] }>(`/api/brands/${brandId}/official-socials`, await getToken(), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: next }),
      });
      setUrls(data.urls);
      return true;
    } catch (err: any) {
      setError(err.message);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const url = newUrl.trim();
    if (!url) return;
    if (await save([...(urls ?? []), url])) setNewUrl("");
  }

  return (
    <div>
      {urls === null ? (
        <LoadingRegion label="Loading official accounts" className="divide-y divide-line rounded-md border border-line">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-2.5">
              <Skeleton className="h-8 w-8" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-40" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
          ))}
        </LoadingRegion>
      ) : urls.length === 0 ? (
        <p className="rounded-md border border-dashed border-line px-3 py-4 text-center text-xs text-ink-subtle">
          None yet. Until the real accounts are listed, the searches may report them as fakes.
        </p>
      ) : (
        <ul className="divide-y divide-line rounded-md border border-line">
          {urls.map((u) => {
            const d = describeOfficial(u);
            return (
              <li key={u} className="flex items-center gap-3 px-3 py-2.5">
                <TargetIcon type={d.type} platform={d.platform} />
                <a href={u} target="_blank" rel="noreferrer" className="min-w-0 flex-1" title={u}>
                  <div className="truncate text-sm font-medium text-ink hover:text-brand">{d.primary}</div>
                  <div className="truncate text-xs text-ink-subtle">{d.secondary}</div>
                </a>
                {editable && <button onClick={() => save(urls.filter((x) => x !== u))} disabled={saving} aria-label={`Remove ${u}`} className="btn-ghost shrink-0 hover:text-red-600">
                  <TrashIcon className="h-3.5 w-3.5" />
                </button>}
              </li>
            );
          })}
        </ul>
      )}

      {editable && <form onSubmit={handleAdd} className="mt-4 flex gap-2">
        <input
          placeholder="Paste a profile, WhatsApp or app store link"
          value={newUrl}
          onChange={(e) => setNewUrl(e.target.value)}
          className="field flex-1"
          aria-label="Official account link"
        />
        <button type="submit" disabled={saving} className="btn-secondary shrink-0">
          {saving ? "Saving…" : "Add"}
        </button>
      </form>}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
