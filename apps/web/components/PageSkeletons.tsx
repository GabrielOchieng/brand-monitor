import { LoadingRegion, Skeleton, SkeletonCard, SkeletonList, SkeletonPageHeader, SkeletonTable } from "./Skeleton";

// One skeleton per page, used twice: by the route's loading.tsx (while the page itself
// loads) and by the page while its data loads. Each mirrors its page's real layout so
// nothing jumps when the content arrives.

export function DashboardSkeleton() {
  return (
    <LoadingRegion label="Loading dashboard">
      <SkeletonPageHeader withSubtitle />
      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-6">
        <div className="card col-span-2 space-y-3 p-5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-10 w-40" />
        </div>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card space-y-3 p-4">
            <Skeleton className="h-3 w-14" />
            <Skeleton className="h-7 w-10" />
          </div>
        ))}
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SkeletonList rows={4} lines={1} />
        </div>
        <SkeletonCard lines={5} />
      </div>
    </LoadingRegion>
  );
}

export function ThreatsSkeleton() {
  return (
    <LoadingRegion label="Loading threats">
      <SkeletonPageHeader withAction />
      <div className="card mt-6 flex flex-wrap items-end gap-3 p-4">
        {["w-32", "w-32", "w-40", "w-64"].map((w, i) => (
          <div key={i} className="space-y-1.5">
            <Skeleton className="h-3 w-14" />
            <Skeleton className={`h-8 ${w}`} />
          </div>
        ))}
      </div>
      <div className="mt-6">
        <SkeletonTable rows={10} />
      </div>
    </LoadingRegion>
  );
}

export function FindingSkeleton() {
  return (
    <LoadingRegion label="Loading finding">
      <Skeleton className="h-4 w-24" />
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Skeleton className="h-7 w-72 max-w-full" />
        <Skeleton className="h-6 w-20" />
      </div>
      <Skeleton className="mt-2 h-4 w-48" />
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="card p-5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-3 aspect-[16/10] w-full" />
          </div>
          <SkeletonCard lines={4} />
          <SkeletonCard lines={3} />
        </div>
        <div className="space-y-6">
          <SkeletonCard lines={3} />
          <SkeletonCard lines={4} />
        </div>
      </div>
    </LoadingRegion>
  );
}

export function MentionsSkeleton() {
  return (
    <LoadingRegion label="Loading mentions">
      <SkeletonPageHeader withSubtitle />
      <div className="card mt-6 flex flex-wrap gap-8 p-5">
        <div className="space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-8 w-12" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-3 w-20" />
          <div className="flex gap-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-6 w-20" />
            ))}
          </div>
        </div>
      </div>
      <div className="mt-6">
        <SkeletonList rows={5} lines={2} />
      </div>
    </LoadingRegion>
  );
}

export function ListPageSkeleton({ label, rows = 6 }: { label: string; rows?: number }) {
  return (
    <LoadingRegion label={label}>
      <SkeletonPageHeader withSubtitle />
      <div className="mt-6">
        <SkeletonList rows={rows} lines={1} />
      </div>
    </LoadingRegion>
  );
}

export function SettingsSkeleton() {
  return (
    <LoadingRegion label="Loading settings">
      <SkeletonPageHeader withSubtitle />
      <div className="mt-6 space-y-6">
        <SkeletonCard lines={2} />
        <SkeletonCard lines={3} />
        <SkeletonCard lines={4} />
      </div>
    </LoadingRegion>
  );
}
