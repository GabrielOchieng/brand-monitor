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
    <section className="mt-8">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Related findings (possible campaign)</h2>
      {!data.matchedOn ? (
        <p className="mt-2 text-sm text-gray-500">
          Can't check for related findings yet -- this finding's registrar/registration date isn't available.
        </p>
      ) : data.relatedFindings.length === 0 ? (
        <p className="mt-2 text-sm text-gray-500">
          No other findings for this brand share a registrar within {data.matchedOn.windowDays} days of this one's registration.
          {data.uncheckableCount > 0 && ` (${data.uncheckableCount} other finding${data.uncheckableCount === 1 ? "" : "s"} couldn't be checked -- registration date unavailable.)`}
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm text-gray-400">
            Registered via <span className="text-gray-200">{data.matchedOn.registrar}</span> within {data.matchedOn.windowDays} days of the
            following:
          </p>
          <ul className="mt-3 divide-y divide-gray-800 rounded border border-gray-800">
            {data.relatedFindings.map((r) => (
              <li key={r.id} className="flex items-center justify-between px-4 py-2 text-sm">
                <Link href={`/threats/${r.id}`} className="text-gray-200 hover:underline">
                  {r.identifier}
                </Link>
                <span className="flex items-center gap-2 text-xs text-gray-500">
                  {r.sharedIp && <span className="rounded border border-gray-700 px-1.5 py-0.5">same IP</span>}
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
