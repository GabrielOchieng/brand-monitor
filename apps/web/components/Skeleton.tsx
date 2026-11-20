// Placeholders shaped like the content they stand in for, so a page shows its layout the
// moment it's opened and fills in as data arrives -- instead of a blank page or a bare
// "Loading…". Pure markup: usable from server (loading.tsx) and client components.

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-md bg-elevated ${className}`} />;
}

// Screen readers get one status message per loading region instead of silent grey boxes.
export function LoadingRegion({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

export function SkeletonPageHeader({ withSubtitle = false, withAction = false }: { withSubtitle?: boolean; withAction?: boolean }) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        {withSubtitle && <Skeleton className="h-4 w-80 max-w-full" />}
      </div>
      {withAction && <Skeleton className="h-9 w-28" />}
    </div>
  );
}

// Rows of a table/list card. `columns` are Tailwind width classes, one per column.
export function SkeletonTable({ rows = 8, columns = ["w-2/5", "w-20", "w-10", "w-24", "w-16", "w-24"] }: { rows?: number; columns?: string[] }) {
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-6 border-b border-line px-4 py-3.5">
        {columns.map((w, i) => (
          <Skeleton key={i} className={`h-3 ${i === 0 ? "w-16" : "w-12"}`} />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex items-center gap-6 border-b border-line px-4 py-4 last:border-b-0">
          {columns.map((w, i) => (
            <Skeleton key={i} className={`h-4 ${w} ${i === 0 ? "" : "hidden sm:block"}`} />
          ))}
        </div>
      ))}
    </div>
  );
}

// A stack of list items (mentions, notifications, reports).
export function SkeletonList({ rows = 5, lines = 2 }: { rows?: number; lines?: number }) {
  return (
    <div className="card divide-y divide-line">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="space-y-2.5 p-4">
          <div className="flex items-center justify-between gap-4">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-5 w-16" />
          </div>
          {Array.from({ length: lines }, (_, l) => (
            <Skeleton key={l} className={`h-3.5 ${l === lines - 1 ? "w-3/5" : "w-full"}`} />
          ))}
        </div>
      ))}
    </div>
  );
}

// A card with a heading and a few lines -- for panels on the finding page and settings.
export function SkeletonCard({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  return (
    <div className={`card space-y-3 p-5 ${className}`}>
      <Skeleton className="h-3 w-32" />
      {Array.from({ length: lines }, (_, l) => (
        <Skeleton key={l} className={`h-4 ${l === lines - 1 ? "w-2/3" : "w-full"}`} />
      ))}
    </div>
  );
}

export function SkeletonStatTiles({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="card space-y-3 p-4">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-8 w-12" />
        </div>
      ))}
    </div>
  );
}
