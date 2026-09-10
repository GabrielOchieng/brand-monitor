import crypto from "node:crypto";

// Signs timestamp + "." + body (not just the raw body) so a receiver can reject
// replays of an old, otherwise-validly-signed payload -- a bare body signature can't
// express "this was sent just now."
function sign(secret: string, timestamp: string, body: string): string {
  return crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

async function postOnce(url: string, body: string, headers: Record<string, string>, timeoutMs: number): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`webhook responded ${res.status}`);
}

// Best-effort integration channel, not the record of truth (email + in-app +
// AlertDelivery are) -- a short timeout and exactly one retry, not a full backoff/
// dead-letter system.
export async function sendWebhook(url: string, secret: string, payload: unknown): Promise<void> {
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = sign(secret, timestamp, body);
  const headers = { "X-Signature": signature, "X-Timestamp": timestamp };

  try {
    await postOnce(url, body, headers, 5000);
  } catch {
    await new Promise((r) => setTimeout(r, 1500));
    await postOnce(url, body, headers, 5000);
  }
}
