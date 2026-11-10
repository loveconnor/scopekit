import { redirect } from "next/navigation";
import { Suspense } from "react";

async function Go({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await params;
  redirect(`/sites/${siteId}/overview`);
  return null;
}

export default function SiteIndex({ params }: PageProps<"/sites/[siteId]">) {
  return (
    <Suspense fallback={null}>
      <Go params={params} />
    </Suspense>
  );
}
