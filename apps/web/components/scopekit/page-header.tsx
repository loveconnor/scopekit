import type { ReactNode } from "react";

/**
 * Title and controls share the first line on every page, so the range control and primary
 * action sit at the same height whether or not the page has a subtitle.
 */
export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="truncate text-[24px] leading-8 font-medium tracking-[-0.01em] text-ink">{title}</h1>
        {subtitle ? <div className="mt-1 text-[13px] leading-5 text-ink-2">{subtitle}</div> : null}
      </div>
      {actions ? <div className="flex min-h-8 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
