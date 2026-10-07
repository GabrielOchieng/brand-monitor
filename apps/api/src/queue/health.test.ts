import { describe, it, expect } from "vitest";
import { jobsHealth, sourcesHealth, JOBS_STALE_AFTER_MS } from "./health";

const now = new Date("2026-10-06T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);

describe("jobsHealth", () => {
  it("is healthy when the recheck dispatcher ran recently", () => {
    expect(jobsHealth(now, ago(5 * 60 * 1000), ago(60 * 60 * 1000)).ok).toBe(true);
  });

  it("is unhealthy once the dispatcher has been silent for the stale window", () => {
    expect(jobsHealth(now, ago(JOBS_STALE_AFTER_MS), ago(60 * 60 * 1000)).ok).toBe(false);
  });

  it("gives a freshly started process a grace period before its first tick", () => {
    expect(jobsHealth(now, null, ago(2 * 60 * 1000)).ok).toBe(true);
  });

  it("is unhealthy when a process has run past the grace period without ever ticking", () => {
    expect(jobsHealth(now, null, ago(JOBS_STALE_AFTER_MS + 1)).ok).toBe(false);
  });
});

describe("sourcesHealth", () => {
  const H = 60 * 60 * 1000;

  it("is stale once a source hasn't succeeded within its window", () => {
    const r = sourcesHealth(now, { ct_log: ago(25 * H), nrd: ago(1 * H) }, ago(100 * H));
    expect(r.sources.ct_log.stale).toBe(true);
    expect(r.sources.nrd.stale).toBe(false);
    expect(r.ok).toBe(false);
  });

  it("gives a fresh process its full window before calling a never-succeeded source stale", () => {
    expect(sourcesHealth(now, {}, ago(2 * H)).ok).toBe(true);
    expect(sourcesHealth(now, {}, ago(49 * H)).ok).toBe(false);
  });
});
