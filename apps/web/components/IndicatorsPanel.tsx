import Link from "next/link";
import { SeverityBadge } from "./SeverityBadge";

export interface FindingIndicatorView {
  kind: string;
  value: string;
  firstSeenAt: string;
  lastSeenAt: string;
  sharedWith: Array<{ id: string; identifier: string; severity: string; status: string }>;
}

const KIND_LABELS: Record<string, string> = {
  phone: "Phone",
  whatsapp: "WhatsApp",
  mpesa_paybill: "M-Pesa paybill",
  mpesa_till: "M-Pesa till",
  email: "Email",
  telegram: "Telegram",
  crypto_wallet: "Crypto wallet",
};

// Contact/payment details pulled from the page (apps/api/src/lib/indicators.ts), minus the
// brand's own. A value shared with other findings is the strongest sign they're one
// operation, and the values themselves are what gets reported (Safaricom, Telegram, exchanges).
export function IndicatorsPanel({ indicators }: { indicators: FindingIndicatorView[] }) {
  if (indicators.length === 0) return null;
  const sharedCount = indicators.filter((i) => i.sharedWith.length > 0).length;

  return (
    <section className="card mt-6 p-5">
      <h2 className="label">Contact &amp; payment details on the page</h2>
      <p className="mt-2 text-sm text-ink-muted">
        {sharedCount > 0
          ? `${sharedCount} of these also appear${sharedCount === 1 ? "s" : ""} on other findings — likely the same operation.`
          : "None of these appear on any other finding yet."}
      </p>
      <ul className="mt-3 divide-y divide-line rounded-md border border-line">
        {indicators.map((i) => (
          <li key={`${i.kind}:${i.value}`} className="px-4 py-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <span className="text-ink-subtle">{KIND_LABELS[i.kind] ?? i.kind}</span>{" "}
                <span className="break-all font-mono text-ink">{i.value}</span>
              </span>
              <span className="text-xs text-ink-subtle" title={`First seen ${new Date(i.firstSeenAt).toLocaleString()}`}>
                last seen {new Date(i.lastSeenAt).toLocaleDateString()}
              </span>
            </div>
            {i.sharedWith.length > 0 && (
              <ul className="mt-1.5 space-y-1 pl-3">
                {i.sharedWith.map((f) => (
                  <li key={f.id} className="flex items-center gap-2 text-xs">
                    <span className="text-ink-subtle">also on</span>
                    <Link href={`/threats/${f.id}`} className="break-all font-mono text-ink hover:text-brand-hover">
                      {f.identifier}
                    </Link>
                    <SeverityBadge severity={f.severity} />
                    {f.status === "false_positive" && <span className="text-ink-subtle">(false positive)</span>}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
