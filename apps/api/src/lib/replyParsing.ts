// Reading abuse-desk replies and bounces (TAKEDOWN_AUTOMATION_PLAN.md §11). Pure functions over a
// message's sender, subject and preview text; pipeline/takedownReplies.ts applies them.

// Our tag: [BM-XXXXXXXX] (lib/reportTemplates.ts newReportRef alphabet).
const REF_RE = /\bBM-[2-9A-HJKMNP-Z]{8}\b/g;

export function reportRefsIn(text: string): string[] {
  return [...new Set(text.toUpperCase().match(REF_RE) ?? [])];
}

const BOUNCE_FROM = /(mailer-daemon|postmaster|mail-daemon|mailerdaemon)@/i;
const BOUNCE_SUBJECT = /(undeliverable|undelivered|delivery status notification|delivery has failed|failure notice|returned mail|mail delivery (failed|subsystem)|could not be delivered|delivery failure)/i;

export function isBounce(m: { from: string; subject: string }): boolean {
  return BOUNCE_FROM.test(m.from) || BOUNCE_SUBJECT.test(m.subject);
}

// Automatic acknowledgements count as replies too (they carry the ticket number), but out-of-office
// notes don't acknowledge anything.
export function isOutOfOffice(m: { subject: string }): boolean {
  return /(out of (the )?office|automatic reply|auto(matic)?[- ]?reply|autoreply|on leave|vacation)/i.test(m.subject) && !/ticket|case|incident|abuse/i.test(m.subject);
}

// The recipient's ticket / case number, if the reply gives one. Never our own BM tag.
export function ticketRefIn(subject: string, snippet: string): string | null {
  const text = `${subject}\n${snippet}`.replace(REF_RE, " ");
  const patterns = [
    /\b(?:ticket|case|incident|request|reference|ref)\s*(?:id|no\.?|number|#)?\s*[:#]?\s*\[?#?([A-Z0-9][A-Z0-9_-]{3,30})\]?/i,
    /\[#?([A-Z]{2,10}-?\d{3,12})\]/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    // Must contain a digit: "Ticket received" would otherwise give "received".
    if (m && /\d/.test(m[1])) return m[1];
  }
  return null;
}

// Which of the report's recipients a bounce is about: those named in it, or the only one.
export function bouncedRecipients(snippet: string, to: string[]): string[] {
  const named = to.filter((a) => snippet.toLowerCase().includes(a.toLowerCase()));
  if (named.length) return named;
  return to.length === 1 ? to : [];
}
