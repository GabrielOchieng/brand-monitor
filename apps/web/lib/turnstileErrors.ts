export type TurnstileFailure = "config" | "blocked";

// Turnstile's error codes (developers.cloudflare.com/turnstile/troubleshooting/client-side-errors):
// the 110xxx family is our setup (110100/110110 invalid site key, 110200 this domain isn't on the
// widget's hostname list, ...), which no visitor can fix. Everything else -- the widget unable to
// reach Cloudflare, a failed challenge -- is treated as something on the visitor's side.
export function turnstileFailureKind(code: string | number | undefined): TurnstileFailure {
  return String(code ?? "").startsWith("110") ? "config" : "blocked";
}
