import { PageHeader } from "@/components/scopekit/page-header";
import { env } from "@/lib/env";
import type { Metadata } from "next";
import { AddSiteFlow } from "./add-site-flow";

export const metadata: Metadata = { title: "Add website" };

export default function NewSitePage() {
  return (
    <div className="mx-auto max-w-[720px]">
      <PageHeader title="Add website" subtitle="Only add sites you own or are authorized to measure" />
      <AddSiteFlow collectorUrl={env.collectorUrl} />
    </div>
  );
}
