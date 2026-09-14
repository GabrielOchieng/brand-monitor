"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { apiFetch } from "../lib/api";

interface RelatedFinding {
  id: string;
  identifier: string;
  riskScore: number;
  severity: string;
  registeredAt: string;
  sharedIp: boolean;
}

interface RelatedResponse {
  relatedFindings: RelatedFinding[];
  matchedOn: { registrar: string; windowDays: number } | null;
  uncheckableCount: number;
}

// v1 correlation is deliberately conservative -- registrar + a tight registration-time
// window only. Nameserver matching is left out entirely (too many unrelated squatters
// share a cheap registrar's generic default DNS), and this only ever looks at pairs, not
// transitive clusters -- see routes/findings.ts for the full reasoning.
export function RelatedFindingsPanel({ findingId }: { findingId: string }) {
  const { getToken } = useAuth();
  const [data, setData] = useState<RelatedResponse | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        const result = await apiFetch<RelatedResponse>(`/api/findings/${findingId}/related`, token);
        setData(result);
      } catch {
        // non-critical panel -- a failed fetch just leaves it hidden
      }
    })();
  }, [getToken, findingId]);

  if (!data) return null;

  return (
    <section className="card mt-6 p-5">
      <h2 className="label">Related findings (possible campaign)</h2>
      {!data.matchedOn ? (
        <p className="mt-2 text-sm text-ink-subtle">
          Can't check for related findings yet -- this finding's registrar/registration date isn't available.
        </p>
      ) : data.relatedFindings.length === 0 ? (
        <p className="mt-2 text-sm text-ink-subtle">
          No other findings for this brand share a registrar within {data.matchedOn.windowDays} days of this one's registration.
          {data.uncheckableCount > 0 && ` (${data.uncheckableCount} other finding${data.uncheckableCount === 1 ? "" : "s"} couldn't be checked -- registration date unavailable.)`}
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm text-ink-muted">
            Registered via <span className="text-ink">{data.matchedOn.registrar}</span> within {data.matchedOn.windowDays} days of the
            following:
          </p>
          <ul className="mt-3 divide-y divide-line rounded-md border border-line">
            {data.relatedFindings.map((r) => (
              <li key={r.id} className="flex items-center justify-between px-4 py-2 text-sm">
                <Link href={`/threats/${r.id}`} className="font-mono text-ink hover:text-brand-hover">
                  {r.identifier}
                </Link>
                <span className="flex items-center gap-2 text-xs text-ink-subtle">
                  {r.sharedIp && <span className="rounded-md border border-line px-1.5 py-0.5">same IP</span>}
                  {new Date(r.registeredAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
