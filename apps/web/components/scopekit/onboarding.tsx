import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Panel } from "./panel";

const STEPS = [
  { title: "Add your website", body: "Name, URL and timezone. That is all it needs to start" },
  { title: "Install tracking", body: "One script tag under 5 KB, with a live check that events arrive" },
  { title: "Connect Search Console", body: "Optional, and not available in this build yet" },
];

/** First run: no sites, so no numbers. The screen says what happens next instead of showing zeros. */
export function FirstRun() {
  return (
    <Panel className="mx-auto mt-10 max-w-[720px] p-8">
      <h2 className="text-[20px] leading-7 font-medium text-ink">Add your first website</h2>
      <p className="mt-1 max-w-[56ch] text-[14px] leading-5 text-ink-2">
        ScopeKit starts measuring from the moment its snippet is installed. Nothing is shown until real events arrive
      </p>
      <ol className="mt-8 flex flex-col gap-5">
        {STEPS.map((step, index) => (
          <li key={step.title} className="flex gap-4">
            <span className="tnum flex size-6 shrink-0 items-center justify-center rounded-full border border-line font-mono text-[12px] text-ink-2">
              {index + 1}
            </span>
            <span>
              <span className="block text-[14px] leading-6 font-medium text-ink">{step.title}</span>
              <span className="block text-[13px] leading-5 text-ink-2">{step.body}</span>
            </span>
          </li>
        ))}
      </ol>
      <Button className="mt-8" render={<Link href="/sites/new" />}>
        Add website
      </Button>
    </Panel>
  );
}
