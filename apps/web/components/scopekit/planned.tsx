import { PageHeader } from "./page-header";
import { Panel } from "./panel";
import { Provenance } from "./provenance";
import type { DataSource } from "@scopekit/contracts";

/**
 * A screen whose data source does not exist yet. It says so plainly, lists what will be
 * measured and where the numbers will come from, and shows no placeholder figures.
 */
export function Planned({
  title,
  subtitle,
  phase,
  source,
  sourceDetail,
  measures,
  caveat,
}: {
  title: string;
  subtitle: string;
  phase: string;
  source: DataSource;
  sourceDetail: string;
  measures: string[];
  caveat?: string;
}) {
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} />
      <Panel className="max-w-[720px] p-6">
        <h2 className="text-[15px] leading-6 font-medium text-ink">Not built yet</h2>
        <p className="mt-1 text-[13px] leading-5 text-ink-2">Planned for {phase}. Nothing is shown here until it reads real data</p>
        <ul className="mt-5 flex flex-col">
          {measures.map((item) => (
            <li key={item} className="border-t border-line py-2 text-[13px] leading-5 text-ink first:border-0 first:pt-0">
              {item}
            </li>
          ))}
        </ul>
        {caveat ? <p className="mt-4 text-[12px] leading-4 text-ink-3">{caveat}</p> : null}
        <Provenance source={source} detail={sourceDetail} className="mt-5" />
      </Panel>
    </>
  );
}
