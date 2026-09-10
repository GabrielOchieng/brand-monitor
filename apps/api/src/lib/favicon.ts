import sharp from "sharp";

const HASH_SIZE = 8; // 8x8 -> 64-bit average hash

// Simple perceptual "average hash": cheap, good enough to catch an exact/near-exact
// cloned favicon (the common case for a copy-pasted phishing kit), not meant to catch
// a redesigned or partially-modified icon -- that's full visual-similarity ML, Phase 2.
export async function computeFaviconHash(imageBuffer: Buffer): Promise<string | null> {
  try {
    const { data } = await sharp(imageBuffer)
      .resize(HASH_SIZE, HASH_SIZE, { fit: "fill" })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const pixels = Array.from(data);
    const mean = pixels.reduce((sum, v) => sum + v, 0) / pixels.length;
    return pixels.map((v) => (v >= mean ? "1" : "0")).join("");
  } catch {
    return null;
  }
}

export function hammingDistance(hashA: string, hashB: string): number {
  if (hashA.length !== hashB.length) return Math.max(hashA.length, hashB.length);
  let distance = 0;
  for (let i = 0; i < hashA.length; i++) {
    if (hashA[i] !== hashB[i]) distance++;
  }
  return distance;
}

export async function fetchFaviconHash(domain: string, userAgent: string): Promise<string | null> {
  try {
    const res = await fetch(`https://${domain}/favicon.ico`, {
      headers: { "User-Agent": userAgent },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength === 0) return null;
    return computeFaviconHash(buffer);
  } catch {
    return null;
  }
}

// Two average-hashes within this many differing bits (out of 64) are treated as a match.
export const FAVICON_MATCH_THRESHOLD = 6;
