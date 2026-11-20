"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";
import { apiFetch } from "../lib/api";
import { TrashIcon } from "./icons";
import { LoadingRegion, Skeleton } from "./Skeleton";
import { Toggle } from "./settings/Section";

interface Keyword {
  id: string;
  keyword: string;
  // Paired with the other core keywords in discovery (fly + book -> flybookjambojet.xyz).
  core: boolean;
}

const MAX_PAIRED = 8;

export function BrandKeywords({ brandId, brandRoot, editable = true }: { brandId: string; brandRoot: string; editable?: boolean }) {
  const { getToken } = useAuth();
  const [keywords, setKeywords] = useState<Keyword[] | null>(null);
  const [newKeyword, setNewKeyword] = useState("");
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await apiFetch<Keyword[]>(`/api/brands/${brandId}/keywords`, await getToken());
    setKeywords(data);
  }, [getToken, brandId]);

  useEffect(() => {
    setKeywords(null);
    load().catch((err) => {
      setKeywords([]);
      setError(err.message);
    });
  }, [load]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const keyword = newKeyword.trim();
    if (!keyword) return;
    setAdding(true);
    setError(null);
    try {
      await apiFetch(`/api/brands/${brandId}/keywords`, await getToken(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword }),
      });
      setNewKeyword("");
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setAdding(false);
    }
  }

  async function setPaired(k: Keyword, core: boolean) {
    setBusyId(k.id);
    setError(null);
    try {
      const updated = await apiFetch<Keyword>(`/api/brands/${brandId}/keywords/${k.id}`, await getToken(), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ core }),
      });
      setKeywords((prev) => (prev ?? []).map((p) => (p.id === k.id ? updated : p)));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function remove(k: Keyword) {
    setBusyId(k.id);
    setError(null);
    try {
      await apiFetch(`/api/brands/${brandId}/keywords/${k.id}`, await getToken(), { method: "DELETE" });
      setKeywords((prev) => (prev ?? []).filter((p) => p.id !== k.id));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  const paired = keywords?.filter((k) => k.core).map((k) => k.keyword) ?? [];

  return (
    <div>
      {keywords === null ? (
        <LoadingRegion label="Loading keywords" className="divide-y divide-line rounded-md border border-line">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center justify-between px-3 py-2.5">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-5 w-9 rounded-full" />
            </div>
          ))}
        </LoadingRegion>
      ) : keywords.length === 0 ? (
        <p className="rounded-md border border-dashed border-line px-3 py-4 text-center text-xs text-ink-subtle">No keywords yet. Discovery only checks typos of the name.</p>
      ) : (
        <div className="overflow-hidden rounded-md border border-line">
          <div className="flex items-center justify-between border-b border-line bg-elevated/50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
            <span>Keyword</span>
            <span className={editable ? "mr-10" : ""}>
              Paired {paired.length}/{MAX_PAIRED}
            </span>
          </div>
          <ul className="divide-y divide-line">
            {keywords.map((k) => (
              <li key={k.id} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-ink">{k.keyword}</div>
                  <div className="truncate text-xs text-ink-subtle">
                    {k.keyword}
                    {brandRoot}.com · {brandRoot}
                    {k.keyword}.com
                  </div>
                </div>
                <Toggle
                  checked={k.core}
                  onChange={(v) => setPaired(k, v)}
                  disabled={!editable || busyId === k.id || (!k.core && paired.length >= MAX_PAIRED)}
                  label={`Pair ${k.keyword} with the other paired keywords`}
                />
                {editable && (
                  <button onClick={() => remove(k)} disabled={busyId === k.id} aria-label={`Remove ${k.keyword}`} className="btn-ghost hover:text-red-600">
                    <TrashIcon className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {paired.length >= 2 && (
        <p className="mt-2 text-xs text-ink-subtle">
          Paired keywords are also combined with each other, e.g. {paired[0]}
          {brandRoot}
          {paired[1]}.xyz.
        </p>
      )}

      {editable && (
        <form onSubmit={handleAdd} className="mt-4 flex gap-2">
          <input placeholder="Add a keyword, e.g. checkin" value={newKeyword} onChange={(e) => setNewKeyword(e.target.value)} className="field flex-1" aria-label="New keyword" />
          <button type="submit" disabled={adding || !newKeyword.trim()} className="btn-secondary shrink-0">
            {adding ? "Adding…" : "Add"}
          </button>
        </form>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
