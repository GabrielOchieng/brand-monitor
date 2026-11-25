"use client";

import { useState } from "react";
import { apiFetch } from "../lib/api";
import { LoadingRegion, Skeleton } from "./Skeleton";
import { timeAgo } from "../lib/format";

interface Explanation {
  status: "pending" | "succeeded" | "failed";
  response: string | null;
  error: string | null;
  model: string;
  createdAt: string;
}

// The API stores a readable sentence since 2026-11-19 (lib/aiExplain.ts describeAiError);
// rows from before that hold raw SDK output like `400 {"type":"error",...}`.
function readableAiError(error: string | null): string {
  if (!error) return "unknown error.";
  if (/^\d{3}\b|^\{|"type":"error"/.test(error)) {
    return /credit balance/i.test(error)
      ? "AI explanations are unavailable: the Anthropic account has run out of credits."
      : "The AI explanation couldn't be generated. Try again later.";
  }
  return error;
}

// ARCHITECTURE.md §9's guardrail: AI output must be clearly labeled as such, distinct
// from the deterministic findings above it on the page -- this panel never presents the
// explanation as if it were itself a scoring signal.
export function AiExplanationPanel({
  findingId,
  initialExplanation,
}: {
  findingId: string;
  initialExplanation: Explanation | null;
}) {
  const [explanation, setExplanation] = useState(initialExplanation);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      const result = await apiFetch<Explanation>(`/api/findings/${findingId}/explain`, { method: "POST" });
      setExplanation(result);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <section className="card p-5">
      <div className="flex items-center gap-2">
        <h2 className="label">AI explanation</h2>
        <span className="rounded-md border border-info/40 bg-info/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-info">
          AI-generated
        </span>
      </div>

      {(generating || explanation?.status === "pending") && (
        <LoadingRegion label="Writing the explanation" className="mt-3 space-y-2 rounded-md border border-border bg-card p-4">
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-4/5" />
          <Skeleton className="h-3.5 w-3/5" />
          <p className="pt-1 text-xs text-subtle">Writing the explanation. This takes a few seconds.</p>
        </LoadingRegion>
      )}

      {explanation?.status === "succeeded" && !generating && (
        <div className="mt-3 rounded-md border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">{explanation.response}</p>
          <p className="mt-2 text-xs text-subtle">
            Written by {explanation.model} {timeAgo(explanation.createdAt)}. It describes the score; it doesn't set it.
          </p>
          <button onClick={handleGenerate} disabled={generating} className="btn-ghost mt-3 px-0 text-xs">
            {generating ? "Regenerating…" : "Regenerate"}
          </button>
        </div>
      )}

      {(!explanation || explanation.status === "failed") && !generating && (
        <div className="mt-3">
          {explanation?.status === "failed" && (
            <p className="text-sm text-sev-critical">Last attempt failed: {readableAiError(explanation.error)}</p>
          )}
          <button onClick={handleGenerate} disabled={generating} className="btn-secondary mt-2">
            {generating ? "Generating…" : "Generate AI explanation"}
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-sev-critical">{error}</p>}
    </section>
  );
}
