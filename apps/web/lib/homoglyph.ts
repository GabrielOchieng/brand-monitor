// Characters in a domain or handle that are there to look like something else: non-ASCII letters
// that mimic Latin ones (acmeaír, аcme with a Cyrillic а) and digits standing in for letters
// between letters (jamb0jet, 1ogin). Returns the indexes (by code point) to highlight.
// A display aid only: detection and scoring live in the API.

const DIGIT_LOOKALIKES = new Set(["0", "1", "3", "5"]);

function isLetter(ch: string | undefined): boolean {
  return !!ch && /^[a-z]$/i.test(ch);
}

export function suspiciousChars(value: string): Set<number> {
  const chars = Array.from(value);
  const out = new Set<number>();
  chars.forEach((ch, i) => {
    if (/[^\x00-\x7F]/.test(ch) && /\p{L}/u.test(ch)) out.add(i);
    else if (DIGIT_LOOKALIKES.has(ch) && isLetter(chars[i - 1]) && isLetter(chars[i + 1])) out.add(i);
  });
  return out;
}
