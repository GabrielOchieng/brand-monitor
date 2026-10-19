"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";
import { apiFetch } from "../lib/api";
import { TrashIcon } from "./icons";

// The brand's real social accounts (and official WhatsApp link). Social search never
// reports these, and their contact numbers count as the brand's own.
export function BrandOfficialAccounts({ brandId }: { brandId: string }) {
  const { getToken } = useAuth();
  const [urls, setUrls] = useState<string[]>([]);
  const [newUrl, setNewUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const token = await getToken();
    const data = await apiFetch<{ urls: string[] }>(`/api/brands/${brandId}/official-socials`, token);
    setUrls(data.urls);
  }, [getToken, brandId]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  async function save(next: string[]) {
    setSaving(true);
    setError(null);
    try {
      const token = await getToken();
      const data = await apiFetch<{ urls: string[] }>(`/api/brands/${brandId}/official-socials`, token, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: next }),
      });
      setUrls(data.urls);
      return true;
    } catch (err: any) {
      setError(err.message.includes("not_a_social_account") ? "That isn't a social account or WhatsApp link." : err.message);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const url = newUrl.trim();
    if (!url) return;
    if (await save([...urls, url])) setNewUrl("");
  }

  return (
    <div className="card mt-3 p-4">
      <div className="label">Official social accounts</div>
      <p className="mt-0.5 text-xs text-ink-subtle">
        The brand's real accounts and WhatsApp link — social search skips them, and accounts named like the brand that
        aren't on this list are flagged.
      </p>

      <ul className="mt-3 space-y-1.5">
        {urls.map((u) => (
          <li key={u} className="flex items-center justify-between gap-2 text-xs">
            <span className="break-all font-mono text-ink">{u}</span>
            <button
              onClick={() => save(urls.filter((x) => x !== u))}
              disabled={saving}
              aria-label={`Remove ${u}`}
              className="shrink-0 text-ink-subtle hover:text-red-600"
            >
              <TrashIcon className="h-3 w-3" />
            </button>
          </li>
        ))}
        {urls.length === 0 && <li className="text-xs text-ink-subtle">None yet.</li>}
      </ul>

      <form onSubmit={handleAdd} className="mt-3 flex gap-2">
        <input
          placeholder="e.g. https://www.tiktok.com/@flyjambojet or https://wa.me/254..."
          value={newUrl}
          onChange={(e) => setNewUrl(e.target.value)}
          className="field-sm flex-1"
        />
        <button type="submit" disabled={saving} className="btn-secondary shrink-0">
          {saving ? "Saving…" : "Add"}
        </button>
      </form>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
