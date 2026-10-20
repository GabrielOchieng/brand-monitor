"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";
import { apiFetch } from "../lib/api";
import { TrashIcon } from "./icons";

interface Keyword {
  id: string;
  keyword: string;
  // Paired with the other core keywords in discovery (fly + book -> flybookjambojet.xyz).
  core: boolean;
}

export function BrandKeywords({ brandId }: { brandId: string }) {
  const { getToken } = useAuth();
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [newKeyword, setNewKeyword] = useState("");
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const token = await getToken();
    const data = await apiFetch<Keyword[]>(`/api/brands/${brandId}/keywords`, token);
    setKeywords(data);
  }, [getToken, brandId]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const keyword = newKeyword.trim();
    if (!keyword) return;
    setAdding(true);
    setError(null);
    try {
      const token = await getToken();
      await apiFetch(`/api/brands/${brandId}/keywords`, token, {
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

  async function handleToggleCore(k: Keyword) {
    setTogglingId(k.id);
    setError(null);
    try {
      const token = await getToken();
      const updated = await apiFetch<Keyword>(`/api/brands/${brandId}/keywords/${k.id}`, token, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ core: !k.core }),
      });
      setKeywords((prev) => prev.map((p) => (p.id === k.id ? updated : p)));
    } catch (err: any) {
      setError(err.message.includes("too_many_core_keywords") ? "At most 8 keywords can be paired." : err.message);
    } finally {
      setTogglingId(null);
    }
  }

  async function handleRemove(id: string) {
    setRemovingId(id);
    setError(null);
    try {
      const token = await getToken();
      await apiFetch(`/api/brands/${brandId}/keywords/${id}`, token, { method: "DELETE" });
      setKeywords((prev) => prev.filter((k) => k.id !== id));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="card mt-3 p-4">
      <div className="label">Discovery keywords</div>
      <p className="mt-0.5 text-xs text-ink-subtle">
        Combined with the brand name to catch lookalikes like "book" + brand → bookjambojet.com
        — a bare typo-check alone would miss these. Click a keyword to pair it with the other
        paired ones too ("fly" + "book" → flybookjambojet.xyz); up to 8.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {keywords.map((k) => (
          <span
            key={k.id}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${
              k.core ? "border-brand bg-brand-muted text-brand" : "border-line bg-surface text-ink"
            }`}
          >
            <button
              onClick={() => handleToggleCore(k)}
              disabled={togglingId === k.id}
              aria-pressed={k.core}
              title={k.core ? "Paired with other paired keywords. Click to unpair." : "Click to pair with other paired keywords"}
            >
              {k.keyword}
              {k.core && <span className="ml-1 font-semibold">· paired</span>}
            </button>
            <button
              onClick={() => handleRemove(k.id)}
              disabled={removingId === k.id}
              aria-label={`Remove ${k.keyword}`}
              className="text-ink-subtle hover:text-red-600"
            >
              <TrashIcon className="h-3 w-3" />
            </button>
          </span>
        ))}
        {keywords.length === 0 && <span className="text-xs text-ink-subtle">No keywords yet.</span>}
      </div>

      <form onSubmit={handleAdd} className="mt-3 flex gap-2">
        <input
          placeholder="Add a keyword (e.g. checkin)"
          value={newKeyword}
          onChange={(e) => setNewKeyword(e.target.value)}
          className="field-sm flex-1"
        />
        <button type="submit" disabled={adding} className="btn-secondary shrink-0">
          {adding ? "Adding…" : "Add"}
        </button>
      </form>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
