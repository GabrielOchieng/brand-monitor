"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "../../lib/session";
import { apiFetch } from "../../lib/api";
import {
  AccountsSection,
  AddBrandSection,
  BrandDetails,
  DeleteBrandSection,
  KeywordsSection,
  ReportFormSection,
  VisualReferenceSection,
  type Brand,
} from "../../components/settings/BrandSettings";
import { AlertSettings } from "../../components/settings/AlertSettings";
import { IntegrationSettings } from "../../components/settings/IntegrationSettings";
import { AutoTakedownSettings } from "../../components/settings/AutoTakedownSettings";
import { ReportTemplateSettings } from "../../components/settings/ReportTemplateSettings";
import { ReportRecipientSettings } from "../../components/settings/ReportRecipientSettings";
import { ReadOnlyNote, Section } from "../../components/settings/Section";
import { TeamMembers } from "../../components/TeamMembers";
import { SettingsSkeleton } from "../../components/PageSkeletons";
import { ChevronDownIcon, PlusIcon } from "../../components/icons";
import { canManage, useMyRole } from "../../lib/useMyRole";
import { pickBrand, writeSelectedBrand } from "../../lib/selectedBrand";
import { PageHeader } from "../../components/ui/PageHeader";

type SectionId = "details" | "keywords" | "accounts" | "report-form" | "visual" | "delete" | "alerts" | "webhook" | "auto-takedown" | "report-templates" | "report-recipients" | "team" | "add-brand";

interface NavItem {
  id: SectionId;
  label: string;
  adminOnly?: boolean;
  danger?: boolean;
}

const GROUPS: Array<{ label: string; brandScoped: boolean; items: NavItem[] }> = [
  {
    label: "Brand",
    brandScoped: true,
    items: [
      { id: "details", label: "Details" },
      { id: "keywords", label: "Discovery keywords" },
      { id: "accounts", label: "Official accounts & apps" },
      { id: "report-form", label: "Public report form" },
      { id: "visual", label: "Visual reference" },
      { id: "delete", label: "Delete brand", adminOnly: true, danger: true },
    ],
  },
  {
    label: "Alerts",
    brandScoped: false,
    items: [
      { id: "alerts", label: "Alert rules" },
      { id: "webhook", label: "Webhook" },
    ],
  },
  {
    label: "Takedowns",
    brandScoped: false,
    items: [
      { id: "auto-takedown", label: "Automatic reporting" },
      { id: "report-templates", label: "Report templates" },
      { id: "report-recipients", label: "Report recipients" },
    ],
  },
  {
    label: "Organization",
    brandScoped: false,
    items: [{ id: "team", label: "Team" }],
  },
];

const ALL_IDS = new Set<string>([...GROUPS.flatMap((g) => g.items.map((i) => i.id)), "add-brand"]);
// Links from before the sidebar (?tab=...) still land in the right place.
const LEGACY_TABS: Record<string, SectionId> = { brand: "details", alerts: "alerts", integrations: "webhook", team: "team" };

// One setting at a time: a sidebar of every setting on the left, the chosen one on the
// right, its id in the URL (?section=keywords) so it can be linked to and survives a reload.
// On narrow screens the sidebar becomes a dropdown.
export default function SettingsPage() {
  return (
    <Suspense fallback={<SettingsSkeleton />}>
      <Settings />
    </Suspense>
  );
}

function Settings() {
  const params = useSearchParams();
  const router = useRouter();
  const { isLoaded, orgId } = useSession();
  const role = useMyRole();
  const [brands, setBrands] = useState<Brand[] | null>(null);
  const [brandId, setBrandId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const requested = params.get("section") ?? LEGACY_TABS[params.get("tab") ?? ""] ?? "details";
  const section: SectionId = ALL_IDS.has(requested) ? (requested as SectionId) : "details";

  const loadBrands = useCallback(
    async (prefer?: string) => {
      const list = await apiFetch<Brand[]>("/api/brands");
      setBrands(list);
      const chosen = list.find((b) => b.id === prefer) ?? pickBrand(list);
      setBrandId(chosen?.id ?? null);
    },
    []
  );

  useEffect(() => {
    if (!isLoaded || !orgId) return;
    loadBrands().catch((err) => {
      setError(err.message);
      setBrands([]);
    });
  }, [isLoaded, orgId, loadBrands]);

  function go(id: SectionId) {
    router.push(`/settings?section=${id}`, { scroll: false });
  }

  function selectBrand(id: string) {
    writeSelectedBrand(id);
    setBrandId(id);
  }

  if (!isLoaded || brands === null || (orgId && role === null)) return <SettingsSkeleton />;

  const editable = canManage(role);
  const brand = brands.find((b) => b.id === brandId) ?? null;
  const visibleGroups = GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => !i.adminOnly || editable) }));
  const brandSection = GROUPS[0].items.some((i) => i.id === section);

  return (
    <div>
      <PageHeader title="Settings" description="Brands and what's monitored, alerts, takedown reporting, and your team." />

      <div className="grid gap-8 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-12">
        {/* Sidebar (dropdown on narrow screens) */}
        <aside className="lg:sticky lg:top-20 lg:self-start">
          {brands.length > 0 && (
            <div className="mb-4">
              <div className="label mb-1">Brand</div>
              <div className="flex gap-2">
                {brands.length > 1 ? (
                  <div className="relative min-w-0 flex-1">
                    <select value={brandId ?? ""} onChange={(e) => selectBrand(e.target.value)} className="field w-full appearance-none py-1.5 pr-8 font-medium" aria-label="Brand">
                      {brands.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDownIcon className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
                  </div>
                ) : (
                  <div className="min-w-0 flex-1 truncate rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink" title={brand?.primaryDomain}>
                    {brand?.name}
                  </div>
                )}
                {editable && (
                  <button onClick={() => go("add-brand")} className="btn-secondary shrink-0 px-2.5" aria-label="Add brand" title="Add brand">
                    <PlusIcon className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="lg:hidden">
            <label className="label mb-1" htmlFor="settings-section">
              Setting
            </label>
            <div className="relative">
              <select id="settings-section" value={section} onChange={(e) => go(e.target.value as SectionId)} className="field w-full appearance-none pr-8">
                {visibleGroups.map((g) => (
                  <optgroup key={g.label} label={g.label}>
                    {g.items.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
                {section === "add-brand" && <option value="add-brand">Add a brand</option>}
              </select>
              <ChevronDownIcon className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
            </div>
          </div>

          <nav className="hidden space-y-6 lg:block" aria-label="Settings">
            {visibleGroups.map((g) => (
              <div key={g.label}>
                <div className="label px-3">{g.label}</div>
                <ul className="mt-1.5 space-y-0.5">
                  {g.items.map((i) => {
                    const active = section === i.id;
                    return (
                      <li key={i.id}>
                        <Link
                          href={`/settings?section=${i.id}`}
                          scroll={false}
                          aria-current={active ? "page" : undefined}
                          className={`block rounded-md px-3 py-1.5 text-sm transition-colors ${
                            active
                              ? "bg-brand/10 font-medium text-brand"
                              : i.danger
                                ? "text-red-600 hover:bg-red-50"
                                : "text-ink-muted hover:bg-elevated hover:text-ink"
                          }`}
                        >
                          {i.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
        </aside>

        {/* The chosen setting */}
        <div className="min-w-0">
          {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
          {!editable && (brandSection || section === "team") && <ReadOnlyNote />}

          {section === "add-brand" ? (
            editable ? (
              <AddBrandSection
                onCreated={async (id) => {
                  writeSelectedBrand(id);
                  await loadBrands(id);
                  go("details");
                }}
              />
            ) : (
              <p className="text-sm text-ink-subtle">Only owners and admins can add brands.</p>
            )
          ) : brandSection && !brand ? (
            <div className="card p-8 text-center">
              <div className="text-sm font-medium text-ink">No brands yet</div>
              <p className="mt-1 text-sm text-ink-subtle">Add a brand to start monitoring.</p>
              {editable && (
                <button onClick={() => go("add-brand")} className="btn-primary mt-4">
                  <PlusIcon className="h-4 w-4" /> Add a brand
                </button>
              )}
            </div>
          ) : (
            <>
              {section === "details" && brand && <BrandDetails brand={brand} editable={editable} onSaved={() => loadBrands(brand.id)} />}
              {section === "keywords" && brand && <KeywordsSection brand={brand} editable={editable} />}
              {section === "accounts" && brand && <AccountsSection brand={brand} editable={editable} />}
              {section === "report-form" && brand && (
                <ReportFormSection
                  brand={brand}
                  editable={editable}
                  onChange={(token) => setBrands((prev) => (prev ?? []).map((b) => (b.id === brand.id ? { ...b, reportToken: token } : b)))}
                />
              )}
              {section === "visual" && brand && <VisualReferenceSection brand={brand} />}
              {section === "delete" && brand && editable && (
                <DeleteBrandSection
                  brand={brand}
                  onDeleted={async () => {
                    await loadBrands();
                    go("details");
                  }}
                />
              )}
              {section === "alerts" && <AlertSettings editable={editable} />}
              {section === "webhook" && <IntegrationSettings editable={editable} />}
              {section === "auto-takedown" && <AutoTakedownSettings role={role} />}
              {section === "report-templates" && <ReportTemplateSettings role={role} brands={brands} />}
              {section === "report-recipients" && <ReportRecipientSettings role={role} />}
              {section === "team" && (
                <Section
                  title="Team"
                  description="Who can see and act on findings. Owners manage everything, including roles; admins manage settings; analysts triage findings; viewers can only look. Owners and admins invite people by email below and pick their role."
                >
                  <TeamMembers />
                </Section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
