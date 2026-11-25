"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { apiFetch } from "./api";
import { useSession } from "./session";
import { pickBrand, writeSelectedBrand } from "./selectedBrand";

export interface BrandSummary {
  id: string;
  name: string;
  primaryDomain: string;
  monitoringPausedAt?: string | null;
  reportToken?: string | null;
}

interface BrandValue {
  brands: BrandSummary[] | null;
  selected: BrandSummary | null;
  select: (id: string) => void;
  reload: () => Promise<void>;
}

const BrandContext = createContext<BrandValue | null>(null);

// The active organization's brands and the one picked in the top bar, shared by every page
// so they agree on which brand they show. Remembered per browser (lib/selectedBrand.ts).
export function BrandProvider({ children }: { children: ReactNode }) {
  const { orgId } = useSession();
  const [brands, setBrands] = useState<BrandSummary[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!orgId) return;
    try {
      const list = await apiFetch<BrandSummary[]>("/api/brands");
      setBrands(list);
      setSelectedId((cur) => (cur && list.some((b) => b.id === cur) ? cur : (pickBrand(list)?.id ?? null)));
    } catch {
      setBrands([]);
    }
  }, [orgId]);

  useEffect(() => {
    setBrands(null);
    reload();
  }, [reload]);

  const select = useCallback((id: string) => {
    writeSelectedBrand(id);
    setSelectedId(id);
  }, []);

  const value = useMemo<BrandValue>(
    () => ({ brands, selected: brands?.find((b) => b.id === selectedId) ?? null, select, reload }),
    [brands, selectedId, select, reload]
  );
  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>;
}

export function useBrands(): BrandValue {
  const value = useContext(BrandContext);
  if (!value) throw new Error("useBrands must be used inside <BrandProvider>");
  return value;
}
