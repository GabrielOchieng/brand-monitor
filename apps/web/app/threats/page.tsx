import Link from "next/link";
import { apiFetch } from "../../lib/api";
import { SeverityBadge } from "../../components/SeverityBadge";

interface FindingRow {
  id: string;
  identifier: string;
  type: string;
  source: string;
  riskScore: number;
  severity: string;
  status: string;
  firstDetectedAt: string;
}

export default async function ThreatsPage() {
  const findings = await apiFetch<FindingRow[]>("/api/findings");

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-100">Threat feed</h1>
      <p className="mt-1 text-gray-400">{findings.length} findings, sorted by risk score.</p>

      <div className="mt-6 overflow-x-auto rounded border border-gray-800">
        <table className="w-full text-sm">
          <thead className="bg-gray-900/50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3">Domain</th>
              <th className="px-4 py-3">Severity</th>
              <th className="px-4 py-3">Score</th>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">First detected</th>
            </tr>
          </thead>
          <tbody>
            {findings.map((f) => (
              <tr key={f.id} className="border-t border-gray-800 hover:bg-gray-900/40">
                <td className="px-4 py-3">
                  <Link href={`/threats/${f.id}`} className="text-blue-400 hover:underline">
                    {f.identifier}
                  </Link>
                </td>
                <td className="px-4 py-3"><SeverityBadge severity={f.severity} /></td>
                <td className="px-4 py-3 font-mono text-gray-200">{f.riskScore}</td>
                <td className="px-4 py-3 text-gray-400">{f.source}</td>
                <td className="px-4 py-3 text-gray-400">{f.status}</td>
                <td className="px-4 py-3 text-gray-400">{new Date(f.firstDetectedAt).toLocaleString()}</td>
              </tr>
            ))}
            {findings.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  No findings yet. Run discovery from the dashboard.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
