import { CommandPalette, MobileBar, ShellProvider } from "@/components/scopekit/shell";
import { SidebarContent, type ShellSite } from "@/components/scopekit/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { env } from "@/lib/env";
import { loadSites } from "@/lib/reports";
import { requireUser } from "@/lib/session";
import { countAlerts, getDb } from "@scopekit/db";
import { Suspense, cache } from "react";

/** One read per request, shared by the sidebar, the phone bar and search. */
const shellData = cache(async () => {
  const user = await requireUser();
  const sites = await loadSites();
  const alerts = await countAlerts(getDb(), sites.map((s) => s.id));
  const shellSites: ShellSite[] = sites.map((s) => ({ id: s.id, name: s.name, hostname: s.primaryHostname, isDemo: s.isDemo }));
  return { user: { email: user.email, name: user.name }, sites: shellSites, openAlerts: alerts.open };
});

async function Sidebar() {
  const data = await shellData();
  return <SidebarContent {...data} demo={env.demo} />;
}

async function PhoneBar() {
  const data = await shellData();
  return <MobileBar {...data} demo={env.demo} />;
}

async function Search() {
  const { sites } = await shellData();
  return <CommandPalette sites={sites} />;
}

function SidebarFallback() {
  return (
    <div className="px-2 pt-2.5">
      <Skeleton className="mx-2 my-2 h-5 w-32" />
      <Skeleton className="mt-2 h-8 w-full" />
      <div className="flex flex-col gap-2 px-2 pt-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-5 w-full" />
        ))}
      </div>
    </div>
  );
}

export default function DashboardLayout({ children }: LayoutProps<"/">) {
  return (
    <ShellProvider>
      <div className="min-h-dvh">
        <a
          href="#content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:text-[13px]"
        >
          Skip to content
        </a>
        <aside data-chrome className="fixed inset-y-0 left-0 z-20 hidden w-[240px] border-r border-line bg-canvas lg:block">
          <Suspense fallback={<SidebarFallback />}>
            <Sidebar />
          </Suspense>
        </aside>
        <div className="min-w-0 lg:pl-[240px]">
          {/* The sidebar carries everything on a wide screen, so the bar exists only where the sidebar is hidden. */}
          <header data-chrome className="sticky top-0 z-10 flex h-12 items-center gap-2 border-b border-line bg-canvas px-3 lg:hidden">
            <Suspense fallback={<Skeleton className="h-6 w-40" />}>
              <PhoneBar />
            </Suspense>
          </header>
          <main id="content" className="mx-auto w-full max-w-[1440px] px-4 pt-6 pb-16 lg:px-8 lg:pt-8">
            {children}
          </main>
        </div>
        <Suspense fallback={null}>
          <Search />
        </Suspense>
      </div>
    </ShellProvider>
  );
}
