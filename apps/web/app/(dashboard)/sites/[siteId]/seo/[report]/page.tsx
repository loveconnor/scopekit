import { Planned } from "@/components/scopekit/planned";
import { notFound } from "next/navigation";
import { Suspense } from "react";

// Search performance, queries, pages, opportunities and indexing have their own routes.
const REPORTS: Record<string, { title: string; measures: string[]; caveat?: string; phase?: string }> = {
  keywords: {
    title: "Tracked keywords",
    measures: ["Keywords you choose, with a target page", "Search Console average position over time"],
    caveat: "Average position is not a live rank. Observed ranks would need a separate SERP provider",
    phase: "phase 5",
  },
};

async function Content({ params }: { params: Promise<{ siteId: string; report: string }> }) {
  const { report } = await params;
  const config = REPORTS[report];
  if (!config) notFound();
  return (
    <Planned
      title={config.title}
      subtitle="Google Search Console"
      phase={config.phase ?? "phase 2"}
      source="gsc"
      sourceDetail="not built"
      measures={config.measures}
      caveat={config.caveat}
    />
  );
}

export default function SeoReportPage({ params }: PageProps<"/sites/[siteId]/seo/[report]">) {
  return (
    <Suspense fallback={null}>
      <Content params={params} />
    </Suspense>
  );
}
