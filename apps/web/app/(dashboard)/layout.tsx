import { Header } from "@/components/scopekit/header";
import { SidebarContent, type ShellSite } from "@/components/scopekit/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { env } from "@/lib/env";
import { loadSites } from "@/lib/reports";
import { requireUser } from "@/lib/session";
import { Suspense } from "react";

async function shellData() {
  const user = await requireUser();
  const sites = await loadSites();
  const shellSites: ShellSite[] = sites.map((s) => ({ id: s.id, name: s.name, hostname: s.primaryHostname, isDemo: s.isDemo }));
  return { user, sites: shellSites };
}

async function Sidebar() {
  const { sites } = await shellData();
  return <SidebarContent sites={sites} demo={env.demo} />;
}

async function HeaderBar() {
  const { user, sites } = await shellData();
  return <Header sites={sites} demo={env.demo} user={{ email: user.email, name: user.name }} />;
}

function SidebarFallback() {
  return (
    <div className="px-4">
      <div className="flex h-14 items-center">
        <Skeleton className="h-5 w-24" />
      </div>
      <div className="flex flex-col gap-2 pt-1">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-6 w-full" />
        ))}
      </div>
    </div>
  );
}

export default function DashboardLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="min-h-dvh">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:text-[13px]"
      >
        Skip to content
      </a>
      <aside data-chrome className="fixed inset-y-0 left-0 z-20 hidden w-[232px] border-r border-line bg-canvas lg:block">
        <Suspense fallback={<SidebarFallback />}>
          <Sidebar />
        </Suspense>
      </aside>
      <div className="min-w-0 lg:pl-[232px]">
        <header
          data-chrome
          className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-line bg-canvas px-4 lg:px-7"
        >
          <Suspense fallback={<Skeleton className="h-8 w-40" />}>
            <HeaderBar />
          </Suspense>
        </header>
        <main id="content" className="mx-auto w-full max-w-[1440px] px-4 pt-6 pb-16 lg:px-7">
          {children}
        </main>
      </div>
    </div>
  );
}
