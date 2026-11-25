"use client";

import { useState } from "react";
import { API_URL } from "../lib/api";
import { DownloadIcon } from "./icons";

// Fetched and handed to the browser as a blob (not a plain link) so a failure can be shown
// inline instead of navigating to an error page. `query` is the feed's current filters/sort.
export function ExportCsvButton({ query }: { query: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleExport() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/findings/export.csv?${query}`, { cache: "no-store", credentials: "include" });
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
      {error && <span className="text-xs text-sev-critical">{error}</span>}
      <button onClick={handleExport} disabled={busy} className="btn-secondary px-3 py-1.5 text-xs">
        <DownloadIcon className="h-3.5 w-3.5" />
        {busy ? "Exporting…" : "Export CSV"}
      </button>
    </span>
  );
}
