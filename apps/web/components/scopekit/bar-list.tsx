import { formatNumber } from "@/lib/format";
import Link from "next/link";
import type { ReactNode } from "react";

export type BarListItem = { key: string; label: ReactNode; value: number; href?: string; title?: string };

/** Ranked list with thin proportional bars: the quiet companion to the main chart. */
export function BarList({ items, valueLabel }: { items: BarListItem[]; valueLabel: string }) {
  const max = Math.max(1, ...items.map((item) => item.value));
  return (
    <ul className="flex flex-col">
      {items.map((item) => {
        const row = (
          <>
            <span className="flex items-baseline justify-between gap-4">
              <span className="min-w-0 truncate text-[13px] leading-5 text-ink" title={item.title}>
                {item.label}
              </span>
              <span className="tnum shrink-0 text-[13px] leading-5 text-ink-2">{formatNumber(item.value)}</span>
            </span>
            <span aria-hidden="true" className="mt-1 block h-1 rounded-full bg-raised">
              <span className="block h-1 rounded-full bg-ink-3/60" style={{ width: `${Math.max(2, (item.value / max) * 100)}%` }} />
            </span>
          </>
        );
        return (
          <li key={item.key}>
            {item.href ? (
              <Link href={item.href} className="-mx-2 block rounded-md px-2 py-2 transition-colors duration-150 ease-out hover:bg-raised">
                {row}
              </Link>
            ) : (
              <div className="py-2">{row}</div>
            )}
          </li>
        );
      })}
      <li className="sr-only">Values are {valueLabel}</li>
    </ul>
  );
}
