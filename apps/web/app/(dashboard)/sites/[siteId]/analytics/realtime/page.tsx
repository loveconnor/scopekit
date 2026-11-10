import { PageHeader } from "@/components/scopekit/page-header";
import { PanelSkeleton } from "@/components/scopekit/panel";
import { Realtime } from "@/components/scopekit/realtime";
import { loadSite } from "@/lib/reports";
import type { Metadata } from "next";
import { Suspense } from "react";

export const metadata: Metadata = { title: "Realtime" };

async function Content({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await params;
  const site = await loadSite(siteId);
  return (
    <>
      <PageHeader title="Realtime" subtitle={`${site.name} · last 30 minutes · counts are approximate`} />
      <Realtime siteId={site.id} />
    </>
  );
}

export default function RealtimePage({ params }: PageProps<"/sites/[siteId]/analytics/realtime">) {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader title="Realtime" subtitle=" " />
          <PanelSkeleton height={200} />
        </>
      }
    >
      <Content params={params} />
    </Suspense>
  );
}
