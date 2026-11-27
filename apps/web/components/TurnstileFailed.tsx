// Shown by the public forms when the spam check can't load (useTurnstile's `failed`): without it
// the API refuses the form, so say why the button stays disabled and what to try instead.
export function TurnstileFailed({ email }: { email?: string | null }) {
  return (
    <div role="alert" className="rounded-md border border-sev-medium/40 bg-sev-medium/10 px-3 py-2.5 text-[13px] leading-relaxed text-foreground">
      The security check couldn&apos;t load, so this form can&apos;t be sent from here. A network filter or a browser extension is
      usually blocking it: try another network (mobile data) or another browser
      {email ? (
        <>
          , or email us at{" "}
          <a href={`mailto:${email}`} className="font-medium text-primary hover:underline">
            {email}
          </a>
        </>
      ) : null}
      .
    </div>
  );
}
