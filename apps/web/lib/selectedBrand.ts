// The brand last picked on the dashboard or settings page, remembered per browser so the
// pages agree. A convenience only: storage can be unavailable (private windows, blocked
// site data), and then every page simply falls back to the first brand.

const KEY = "bm.selectedBrandId";

export function readSelectedBrand(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function writeSelectedBrand(id: string): void {
  try {
    window.localStorage.setItem(KEY, id);
  } catch {
    // ignore
  }
}

// The remembered brand if it still exists, otherwise the first one.
export function pickBrand<T extends { id: string }>(brands: T[]): T | null {
  const saved = readSelectedBrand();
  return brands.find((b) => b.id === saved) ?? brands[0] ?? null;
}
