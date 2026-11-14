import { DefaultRangeSetting } from "@/components/scopekit/default-range";
import { PageHeader } from "@/components/scopekit/page-header";
import { Panel, PanelSkeleton } from "@/components/scopekit/panel";
import { ThemeSetting } from "@/components/scopekit/theme";
import { env } from "@/lib/env";
import { loadPreferences } from "@/lib/reports";
import { requireUser } from "@/lib/session";
import { METRIC_DEFINITIONS } from "@scopekit/analytics";
import type { Metadata } from "next";
import { Suspense } from "react";

export const metadata: Metadata = { title: "Settings" };

function Row({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-x-10 gap-y-3 border-b border-line p-6 last:border-0 lg:grid-cols-[240px_minmax(0,1fr)]">
      <div>
        <h2 className="text-[15px] leading-6 font-medium text-ink">{title}</h2>
        {description ? <p className="mt-1 text-[13px] leading-5 text-ink-2">{description}</p> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

async function Content() {
  const user = await requireUser();
  const prefs = await loadPreferences();
  return (
    <div className="sk-enter flex flex-col gap-4">
      <Panel>
        <Row title="Appearance">
          <ThemeSetting initial={prefs.theme} />
        </Row>
        <Row title="Default range">
          <DefaultRangeSetting initial={prefs.defaultRange} />
        </Row>
        <Row title="Account">
          <p className="font-mono text-[13px] leading-5 text-ink">{user.email}</p>
        </Row>
        <Row title="Collector">
          <p className="font-mono text-[13px] leading-5 text-ink">{env.collectorUrl || "NEXT_PUBLIC_COLLECTOR_URL is not set"}</p>
        </Row>
      </Panel>

      <Panel>
        <div className="px-6 pt-5 pb-2">
          <h2 className="text-[15px] leading-6 font-medium text-ink">Metric definitions</h2>
        </div>
        <dl className="px-6 pb-4">
          {Object.entries(METRIC_DEFINITIONS).map(([key, def]) => (
            <div key={key} className="grid gap-x-10 gap-y-1 border-t border-line py-3 lg:grid-cols-[216px_minmax(0,1fr)]">
              <dt className="text-[13px] leading-5 text-ink">{def.label}</dt>
              <dd>
                <span className="block text-[13px] leading-5 text-ink-2">{def.definition}</span>
              </dd>
            </div>
          ))}
        </dl>
      </Panel>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <div className="max-w-[960px]">
      <PageHeader title="Settings" />
      <Suspense fallback={<PanelSkeleton height={240} />}>
        <Content />
      </Suspense>
    </div>
  );
}
