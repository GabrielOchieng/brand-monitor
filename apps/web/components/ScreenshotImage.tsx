"use client";

import { useEffect, useRef, useState } from "react";

// A finding can point at a screenshot file the API no longer has: production lost every
// screenshot on each deploy until the screenshots volume was mounted (2026-11-20), and a
// scan that returns no screenshot keeps the old path. Show that plainly, not a broken image.
export function ScreenshotImage({ src, alt }: { src: string; alt: string }) {
  const [missing, setMissing] = useState(false);
  const ref = useRef<HTMLImageElement>(null);

  // The image can fail before React hydrates and attaches onError; catch that case too.
  useEffect(() => {
    const img = ref.current;
    if (img && img.complete && img.naturalWidth === 0) setMissing(true);
  }, []);

  if (missing) {
    return <p className="mt-3 text-sm text-ink-subtle">Screenshot not available. A new one is taken on the next successful scan.</p>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img ref={ref} src={src} alt={alt} onError={() => setMissing(true)} className="mt-3 max-w-full rounded-md border border-line" />
  );
}
