"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";
import { apiFetch } from "../lib/api";
import { TrashIcon } from "./icons";

interface Keyword {
  id: string;
  keyword: string;
}

export function BrandKeywords({ brandId }: { brandId: string }) {
  const { getToken } = useAuth();
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [newKeyword, setNewKeyword] = useState("");
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
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
        — a bare typo-check alone would miss these.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {keywords.map((k) => (
          <span
            key={k.id}
            className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-xs text-ink"
          >
            {k.keyword}
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
