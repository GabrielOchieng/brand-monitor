import sharp from "sharp";

// Headless Chromium screenshots have no browser chrome, so a finding's screenshot alone
// doesn't show which site it is -- weak evidence in a takedown report. This draws an
// address-bar strip above the saved image: the page's final URL (after redirects) and the
// capture time in UTC. It's labelled as our capture, not dressed up as a real browser.
//
// Only the saved/served copy gets the bar. Visual similarity (lib/visualSimilarity.ts)
// hashes the untouched page image, so the bar can't affect matching.

const BAR_HEIGHT = 48; // at the scanner's 1280px viewport; scales with image width
const FONT = "Liberation Sans, DejaVu Sans, Arial, Helvetica, sans-serif";

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);
}

export function captureLabel(capturedAt: Date): string {
  return `Captured ${capturedAt.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

// Fits the URL into roughly `maxChars`, keeping the host and the start of the path.
export function fitUrl(url: string, maxChars: number): string {
  return url.length <= maxChars ? url : `${url.slice(0, Math.max(10, maxChars - 1))}…`;
}

export function addressBarSvg(url: string, capturedAt: Date, width: number): string {
  const scale = width / 1280;
  const h = Math.round(BAR_HEIGHT * scale);
  const pad = 12 * scale;
  const pillY = 8 * scale;
  const pillH = h - 16 * scale;
  const fontSize = 15 * scale;
  const smallSize = 12 * scale;
  const label = captureLabel(capturedAt);
  // Roughly 0.55em per character for these sans faces; leaves room for the label.
  const labelWidth = label.length * smallSize * 0.55;
  const urlRoom = width - 2 * pad - 2 * 14 * scale - labelWidth - 24 * scale;
  const shownUrl = fitUrl(url, Math.floor(urlRoom / (fontSize * 0.55)));
  // librsvg ignores dominant-baseline, so place the baselines by hand: about 0.35em below
  // the pill's centre line centres cap-height text.
  const urlY = pillY + pillH / 2 + fontSize * 0.35;
  const labelY = pillY + pillH / 2 + smallSize * 0.35;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}">
  <rect width="${width}" height="${h}" fill="#dee1e6"/>
  <rect x="${pad}" y="${pillY}" width="${width - 2 * pad}" height="${pillH}" rx="${pillH / 2}" fill="#ffffff" stroke="#c4c7cc" stroke-width="${Math.max(1, scale)}"/>
  <text x="${pad + 14 * scale}" y="${urlY}" font-family="${FONT}" font-size="${fontSize}" fill="#202124">${escapeXml(shownUrl)}</text>
  <text x="${width - pad - 14 * scale}" y="${labelY}" text-anchor="end" font-family="${FONT}" font-size="${smallSize}" fill="#5f6368">${escapeXml(label)}</text>
</svg>`;
}

export async function withAddressBar(png: Buffer, url: string, capturedAt: Date = new Date()): Promise<Buffer> {
  const { width } = await sharp(png).metadata();
  if (!width) throw new Error("screenshot has no width");
  const bar = Buffer.from(addressBarSvg(url, capturedAt, width));
  const barHeight = Math.round(BAR_HEIGHT * (width / 1280));
  return sharp(png)
    .extend({ top: barHeight, background: "#dee1e6" })
    .composite([{ input: bar, top: 0, left: 0 }])
    .png()
    .toBuffer();
}
