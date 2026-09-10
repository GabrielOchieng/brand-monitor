// Candidate lookalike-domain generator. No paid CT-log/NRD feed needed for the POC --
// this is the same technique tools like dnstwist use: generate plausible typosquat/
// homoglyph variants of the brand name, then let dnsCheck.ts find out which are
// actually registered. See ARCHITECTURE.md §5.1 for the full-product version of this
// (Bloom-filter-gated matching against many tenants' brand terms at once) -- for a
// single seeded brand, generate-then-check is simpler and sufficient.

const KEYBOARD_NEIGHBORS: Record<string, string[]> = {
  a: ["s", "q", "z"],
  b: ["v", "n", "g"],
  c: ["x", "v", "d"],
  d: ["s", "f", "e"],
  e: ["w", "r", "d"],
  f: ["d", "g", "r"],
  g: ["f", "h", "t"],
  h: ["g", "j", "y"],
  i: ["u", "o", "k"],
  j: ["h", "k", "u"],
  k: ["j", "l", "i"],
  l: ["k", "o"],
  m: ["n", "j"],
  n: ["b", "m", "h"],
  o: ["i", "p", "l"],
  p: ["o", "l"],
  q: ["w", "a"],
  r: ["e", "t", "f"],
  s: ["a", "d", "w"],
  t: ["r", "y", "g"],
  u: ["y", "i", "j"],
  v: ["c", "b", "f"],
  w: ["q", "e", "s"],
  x: ["z", "c", "s"],
  y: ["t", "u", "h"],
  z: ["a", "s", "x"],
};

// Confusable substitutions used by real homoglyph-typosquats: some are visual multi-char
// tricks (rn -> m), some are digit look-alikes, some are Cyrillic look-alikes of Latin
// letters (these render identically in most fonts and are a classic phishing technique).
const CONFUSABLE_SUBSTITUTIONS: Array<[string, string]> = [
  ["rn", "m"],
  ["vv", "w"],
  ["cl", "d"],
  ["m", "rn"],
  ["l", "1"],
  ["i", "1"],
  ["o", "0"],
  ["a", "а"], // Cyrillic а
  ["e", "е"], // Cyrillic е
  ["o", "о"], // Cyrillic о
  ["p", "р"], // Cyrillic р
];

export interface Candidate {
  domain: string; // full domain incl. TLD
  technique: string;
  isHomoglyph: boolean;
}

function omissions(word: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < word.length; i++) out.push(word.slice(0, i) + word.slice(i + 1));
  return out;
}

function transpositions(word: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < word.length - 1; i++) {
    const chars = word.split("");
    [chars[i], chars[i + 1]] = [chars[i + 1], chars[i]];
    out.push(chars.join(""));
  }
  return out;
}

function doublings(word: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < word.length; i++) out.push(word.slice(0, i + 1) + word[i] + word.slice(i + 1));
  return out;
}

function keyboardSubstitutions(word: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < word.length; i++) {
    const neighbors = KEYBOARD_NEIGHBORS[word[i]] ?? [];
    for (const n of neighbors) out.push(word.slice(0, i) + n + word.slice(i + 1));
  }
  return out;
}

function hyphenations(word: string): string[] {
  const out: string[] = [];
  for (let i = 1; i < word.length; i++) out.push(word.slice(0, i) + "-" + word.slice(i));
  return out;
}

function homoglyphSubstitutions(word: string): string[] {
  const out: string[] = [];
  for (const [from, to] of CONFUSABLE_SUBSTITUTIONS) {
    let idx = word.indexOf(from);
    while (idx !== -1) {
      out.push(word.slice(0, idx) + to + word.slice(idx + from.length));
      idx = word.indexOf(from, idx + 1);
    }
  }
  return out;
}

function toAscii(sld: string): string {
  // Encode non-ASCII (Cyrillic confusables) as punycode the way a real registration would be.
  try {
    return new URL(`http://${sld}.example`).hostname.replace(".example", "");
  } catch {
    return sld;
  }
}

const CORE_TLDS = ["com", "net", "co.ke", "xyz"];
const EXTENDED_TLDS = ["com", "net", "org", "info", "xyz", "top", "co.ke", "africa", "online", "site", "shop"];
const HIGH_RISK_TLDS = new Set(["xyz", "top", "online", "site", "shop", "info"]);

export function isHighRiskTld(domain: string): boolean {
  const tld = EXTENDED_TLDS.find((t) => domain.endsWith(`.${t}`));
  return tld ? HIGH_RISK_TLDS.has(tld) : false;
}

export function generateCandidates(brandRoot: string, concatKeywords: string[]): Candidate[] {
  const root = brandRoot.toLowerCase();
  const seen = new Set<string>();
  const bodies: Array<{ sld: string; technique: string; isHomoglyph: boolean }> = [];

  const pushBody = (sld: string, technique: string, isHomoglyph = false) => {
    const ascii = isHomoglyph ? toAscii(sld) : sld;
    if (ascii === root || seen.has(ascii)) return;
    seen.add(ascii);
    bodies.push({ sld: ascii, technique, isHomoglyph });
  };

  for (const v of omissions(root)) pushBody(v, "omission");
  for (const v of transpositions(root)) pushBody(v, "transposition");
  for (const v of doublings(root)) pushBody(v, "doubling");
  for (const v of keyboardSubstitutions(root)) pushBody(v, "keyboard_substitution");
  for (const v of hyphenations(root)) pushBody(v, "hyphenation");
  for (const v of homoglyphSubstitutions(root)) pushBody(v, "homoglyph", true);

  const candidates: Candidate[] = [];
  for (const body of bodies) {
    for (const tld of CORE_TLDS) {
      candidates.push({ domain: `${body.sld}.${tld}`, technique: body.technique, isHomoglyph: body.isHomoglyph });
    }
  }

  // Brand+keyword concatenations (e.g. jambojet-support.com) simulate the common
  // phishing-kit pattern of a support/login/refund-themed lookalike; check these across
  // the full extended TLD list since that's where such kits are actually hosted.
  // Covers both suffix forms (jambojet-support / jambojetsupport) and both prefix forms
  // (fly-jambojet / flyjambojet) -- a no-hyphen prefix concatenation like "flyjambojet"
  // is a real, common pattern (a generic/descriptive word glued in front of the brand
  // name) that was missing here until confirmed against a real example.
  const concatPatterns = (kw: string) => [`${root}-${kw}`, `${root}${kw}`, `${kw}-${root}`, `${kw}${root}`];
  for (const kw of concatKeywords) {
    for (const sld of concatPatterns(kw)) {
      if (seen.has(sld)) continue;
      seen.add(sld);
      for (const tld of EXTENDED_TLDS) {
        candidates.push({ domain: `${sld}.${tld}`, technique: "brand_keyword_concat", isHomoglyph: false });
      }
    }
  }

  return candidates;
}
