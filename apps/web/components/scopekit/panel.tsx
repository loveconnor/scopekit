import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/** The one card treatment: surface, hairline, 10px radius. Depth comes from the border. */
export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cn("min-w-0 rounded-lg border border-line bg-surface", className)}>{children}</section>;
}

export function PanelHeader({
  title,
  description,
  meta,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** Usually the provenance tag. */
  meta?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 pt-4 pb-3">
      <div className="min-w-0">
        <h2 className="text-[15px] leading-6 font-medium text-ink">{title}</h2>
        {description ? <p className="text-[13px] leading-5 text-ink-2">{description}</p> : null}
      </div>
      <div className="flex items-center gap-3">
        {meta}
        {action}
      </div>
    </div>
  );
}

export function PanelBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("px-5 pb-5", className)}>{children}</div>;
}

/** Quiet inline state for a panel with nothing to show. Says why, and what to do about it. */
export function PanelEmpty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-1 px-5 pt-1 pb-5">
      <p className="text-[13px] leading-5 font-medium text-ink">{title}</p>
      {children ? <p className="max-w-[60ch] text-[13px] leading-5 text-ink-2">{children}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function PanelSkeleton({ height = 240, className }: { height?: number; className?: string }) {
  return (
    <Panel className={className}>
      <div className="px-5 pt-4 pb-5">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="mt-4 w-full" style={{ height }} />
      </div>
    </Panel>
  );
}

export function KpiSkeletonRow({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <Panel key={i} className="h-[136px] p-5">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-4 h-8 w-28" />
          <Skeleton className="mt-4 h-3 w-36" />
        </Panel>
      ))}
    </div>
  );
}
