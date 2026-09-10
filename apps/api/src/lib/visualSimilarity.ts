import sharp from "sharp";
import { computeAverageHash, hammingDistance } from "./favicon";

// A single whole-image average-hash doesn't survive real page noise (cookie banners,
// lazy-loaded hero images, ads) -- a bigger grid doesn't fix this, it's a structural
// limitation of brightness-averaging on content-sparse pages. Instead: split the
// screenshot into a small fixed grid of independently-hashed regions and score a match
// as "most regions individually match," so one corrupted region (a banner) doesn't
// poison the whole comparison. Coarse heuristic, expect noise -- this is meant to catch
// an exact/near-exact page clone, not a redesigned-but-similar page (same honest scope
// limitation favicon.ts's average-hash already states for icons).
const REGION_GRID = 4; // 4x4 = 16 regions
const REGION_HASH_SIZE = 8; // each region hashed the same way favicon.ts hashes a whole icon
const CROP_TOP_FRACTION = 0.15; // exclude the most banner-prone strip before hashing
const PER_REGION_THRESHOLD = 6; // same per-region tolerance as FAVICON_MATCH_THRESHOLD
const MIN_MATCHING_REGIONS = 11; // ~70% of 16 regions

export async function computeRegionalHashes(imageBuffer: Buffer): Promise<string[] | null> {
  try {
    const meta = await sharp(imageBuffer).metadata();
    if (!meta.width || !meta.height) return null;

    const top = Math.round(meta.height * CROP_TOP_FRACTION);
    const usableHeight = meta.height - top;
    const regionWidth = Math.floor(meta.width / REGION_GRID);
    const regionHeight = Math.floor(usableHeight / REGION_GRID);
    if (regionWidth < 1 || regionHeight < 1) return null;

    const hashes: string[] = [];
    for (let row = 0; row < REGION_GRID; row++) {
      for (let col = 0; col < REGION_GRID; col++) {
        const regionBuffer = await sharp(imageBuffer)
          .extract({ left: col * regionWidth, top: top + row * regionHeight, width: regionWidth, height: regionHeight })
          .toBuffer();
        const hash = await computeAverageHash(regionBuffer, REGION_HASH_SIZE);
        if (!hash) return null;
        hashes.push(hash);
      }
    }
    return hashes;
  } catch {
    return null;
  }
}

export function regionalHashesMatch(a: string[], b: string[]): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let matching = 0;
  for (let i = 0; i < a.length; i++) {
    if (hammingDistance(a[i], b[i]) <= PER_REGION_THRESHOLD) matching++;
  }
  return matching >= MIN_MATCHING_REGIONS;
}

// Stored as a single delimited string (WebsiteIntel.screenshotHash / BrandAsset.hash are
// both plain String columns) rather than adding a new array column for 16 short strings.
export function serializeRegionalHashes(hashes: string[]): string {
  return hashes.join("|");
}

export function deserializeRegionalHashes(serialized: string): string[] {
  return serialized.split("|");
}
