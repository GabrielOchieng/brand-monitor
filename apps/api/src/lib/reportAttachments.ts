import fs from "node:fs/promises";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import { screenshotFileOf } from "./reportContext";

// The files a report carries: the finding's latest screenshot (if chosen) and the chosen
// authorization documents. Read inside withTenant (documents are RLS-scoped).
export async function loadAttachments(
  tx: Prisma.TransactionClient,
  orgId: string,
  action: { findingId: string; includeScreenshot: boolean; documentIds: string[] }
): Promise<Array<{ filename: string; contentType: string; content: Buffer }>> {
  const out: Array<{ filename: string; contentType: string; content: Buffer }> = [];
  if (action.includeScreenshot) {
    const finding = await tx.finding.findUnique({ where: { id: action.findingId }, select: { websiteIntel: { select: { screenshotPath: true } } } });
    const file = screenshotFileOf(finding?.websiteIntel?.screenshotPath);
    if (file) {
      const content = await fs.readFile(path.join(process.cwd(), "screenshots", file)).catch(() => null);
      if (content) out.push({ filename: "screenshot.png", contentType: "image/png", content });
    }
  }
  if (action.documentIds.length) {
    const docs = await tx.takedownDocument.findMany({ where: { id: { in: action.documentIds }, organizationId: orgId }, select: { filename: true, contentType: true, data: true } });
    for (const d of docs) out.push({ filename: d.filename, contentType: d.contentType, content: Buffer.from(d.data) });
  }
  return out;
}
