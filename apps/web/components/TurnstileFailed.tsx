import type { TurnstileFailure } from "../lib/turnstileErrors";

// Shown by the public forms when the spam check fails (useTurnstile's `failure`): without it the
// API refuses the form, so say why the button stays disabled and what to try instead. A setup
// error is ours, so it doesn't send the visitor off changing networks.
export function TurnstileFailed({ kind, email }: { kind: TurnstileFailure; email?: string | null }) {
  const contact = email ? (
    <>
      , or email us at{" "}
      <a href={`mailto:${email}`} className="font-medium text-primary hover:underline">
        {email}
      </a>
    </>
  ) : null;
  return (
    <div role="alert" className="rounded-md border border-sev-medium/40 bg-sev-medium/10 px-3 py-2.5 text-[13px] leading-relaxed text-foreground">
      {kind === "config" ? (
        <>
          The security check isn&apos;t set up correctly on our side, so this form can&apos;t be sent right now. Please try again later
          {contact}.
        </>
      ) : (
        <>
          The security check couldn&apos;t load, so this form can&apos;t be sent from here. A network filter or a browser extension is
          usually blocking it: try another network (mobile data) or another browser
          {contact}.
        </>
      )}
    </div>
  );
}
