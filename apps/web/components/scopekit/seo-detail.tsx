import { formatNumber, formatPercent, formatPosition } from "@/lib/format";
import { metricsOf } from "@/lib/seo";
import type { GscPairRow, GscTotals } from "@scopekit/db";
import { X } from "honestui/icons";
import Link from "next/link";
import type { ReactNode } from "react";
import { Panel, PanelEmpty } from "./panel";
import { Provenance } from "./provenance";

/** One query or page in focus: its own totals, and the pages or queries it is paired with. */
export function SubjectDetail({
  heading,
  subject,
  mono,
  totals,
  through,
  closeHref,
  actions,
  pairsTitle,
  pairsNote,
  pairs,
  pairHref,
  pairDisplay,
}: {
  heading: string;
  subject: string;
  mono?: boolean;
  totals: GscTotals;
  through: string;
  closeHref: string;
  actions?: ReactNode;
  pairsTitle: string;
  pairsNote: string;
  pairs: GscPairRow[];
  pairHref: (key: string) => string;
  pairDisplay?: (key: string) => string;
}) {
  const { ctr, position } = metricsOf(totals);
  const figures: [string, string][] = [
    ["Clicks", formatNumber(totals.clicks)],
    ["Impressions", formatNumber(totals.impressions)],
    ["CTR", formatPercent(ctr, 2)],
    ["Avg. position", formatPosition(position)],
  ];
  return (
    <Panel className="sk-enter">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 px-5 pt-4 pb-3">
        <div className="min-w-0">
          <p className="text-[12px] leading-4 text-ink-3">{heading}</p>
          <h2 className={mono ? "font-mono text-[13px] leading-6 break-all text-ink" : "text-[15px] leading-6 font-medium break-words text-ink"}>{subject}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          <Link href={closeHref} scroll={false} className="inline-flex size-8 items-center justify-center rounded-md text-ink-2 hover:bg-raised hover:text-ink" aria-label="Close detail">
            <X size={16} strokeWidth={1.5} aria-hidden="true" />
          </Link>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-y border-line px-5 py-4 sm:grid-cols-4">
        {figures.map(([label, value]) => (
          <div key={label}>
            <dt className="text-[12px] leading-4 text-ink-3">{label}</dt>
            <dd className="tnum text-[20px] leading-7 font-medium text-ink">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-4 pb-2">
        <h3 className="text-[13px] leading-5 font-medium text-ink">{pairsTitle}</h3>
        <Provenance source="gsc" detail={through} />
      </div>
      {pairs.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-[13px]">
            <tbody>
              {pairs.map((pair) => (
                <tr key={pair.key} className="border-t border-line">
                  <th scope="row" className="h-10 w-full max-w-0 pl-5 text-left font-normal">
                    <Link href={pairHref(pair.key)} scroll={false} title={pair.key} className={mono ? "block truncate rounded-sm text-ink" : "block truncate rounded-sm font-mono text-[12px] text-ink"}>
                      {pairDisplay ? pairDisplay(pair.key) : pair.key}
                    </Link>
                  </th>
                  <td className="tnum h-10 px-3 text-right whitespace-nowrap text-ink">{formatNumber(pair.clicks)} clicks</td>
                  <td className="tnum h-10 px-3 text-right whitespace-nowrap text-ink-2">{formatNumber(pair.impressions)} impr.</td>
                  <td className="tnum h-10 pr-5 pl-3 text-right whitespace-nowrap text-ink-2">pos. {formatPosition(metricsOf(pair).position)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <PanelEmpty title="No pairs stored for this range" />
      )}
      <p className="border-t border-line px-5 py-3 text-[12px] leading-4 text-ink-3">{pairsNote}</p>
    </Panel>
  );
}
