import path from "node:path";
import fs from "node:fs/promises";
import { SCANNER_USER_AGENT } from "@brand-monitor/shared";
import { withTenant } from "../lib/tenant";
import { fetchFaviconHash } from "../lib/favicon";

const SCREENSHOT_DIR = path.join(process.cwd(), "screenshots");

export async function ensureBrandFaviconHash(orgId: string, brandId: string, primaryDomain: string): Promise<string | null> {
  const existing = await withTenant(orgId, (tx) => tx.brandAsset.findFirst({ where: { brandId, type: "favicon" } }));
  if (existing) return existing.hash;

  const hash = await fetchFaviconHash(primaryDomain, SCANNER_USER_AGENT);
  if (!hash) return null;

  await withTenant(orgId, (tx) =>
    tx.brandAsset.create({
      data: { brandId, type: "favicon", sourceUrl: `https://${primaryDomain}/favicon.ico`, hash },
    })
  );
  return hash;
}

export async function saveScreenshot(findingId: string, base64: string): Promise<string> {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  const filename = `${findingId}.png`;
  await fs.writeFile(path.join(SCREENSHOT_DIR, filename), Buffer.from(base64, "base64"));
  return `/screenshots/${filename}`;
}
