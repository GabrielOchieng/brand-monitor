"use client";

import { useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { API_URL } from "../lib/api";
import { DownloadIcon } from "./icons";

// The export needs the Clerk token, so it can't be a plain link: fetch it, then hand the
// browser the blob as a download. `query` is the feed's current filters/sort.
export function ExportCsvButton({ query }: { query: string }) {
  const { getToken } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleExport() {
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/findings/export.csv?${query}`, {
        cache: "no-store",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(res.status === 429 ? "Too many requests. Try again later." : `Export failed (${res.status})`);
      const filename = res.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "findings.csv";
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      {error && <span className="text-xs text-red-600">{error}</span>}
      <button onClick={handleExport} disabled={busy} className="btn-secondary px-3 py-1.5 text-xs">
        <DownloadIcon className="h-3.5 w-3.5" />
        {busy ? "Exporting…" : "Export CSV"}
      </button>
    </span>
  );
}
