"use client";

import { GLOBAL_NAV, isActive, siteNav, type NavItem } from "@/lib/nav";
import { RANGE_KEYS } from "@/lib/params";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { useParams, usePathname, useSearchParams } from "next/navigation";
import { Logo } from "./logo";
import { NavIcon } from "./nav-icon";

export type ShellSite = { id: string; name: string; hostname: string; isDemo: boolean };

/**
 * Filters (page, source, country and so on) belong to one site's analytics reports, so they
 * follow the link only between those pages. Range and comparison follow everywhere through
 * the saved-view cookie.
 */
function useCarriedQuery(href: string, pathname: string): string {
  const searchParams = useSearchParams();
  const analytics = (path: string) => /^\/sites\/[^/]+\/analytics(\/|$)/.test(path);
  const sameSite = href.split("/").slice(0, 3).join("/") === pathname.split("/").slice(0, 3).join("/");
  const carried = new URLSearchParams();
  for (const [key, value] of searchParams) {
    if (RANGE_KEYS.includes(key as (typeof RANGE_KEYS)[number])) carried.append(key, value);
    else if (key.startsWith("f_") && sameSite && analytics(href) && analytics(pathname)) carried.append(key, value);
  }
  const query = carried.toString();
  return query ? `${href}?${query}` : href;
}

function NavLink({ item, pathname, onNavigate }: { item: NavItem; pathname: string; onNavigate?: () => void }) {
  const active = isActive(pathname, item);
  const href = useCarriedQuery(item.href, pathname);
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] leading-5 transition-colors duration-150 ease-out",
        active ? "bg-raised text-ink" : "text-ink-2 hover:bg-raised hover:text-ink",
      )}
    >
      <NavIcon name={item.icon} className={cn("shrink-0", active ? "text-ink" : "text-ink-3")} />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

export function SidebarContent({
  sites,
  demo,
  onNavigate,
}: {
  sites: ShellSite[];
  demo: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const params = useParams<{ siteId?: string }>();
  const site = params.siteId ? sites.find((s) => s.id === params.siteId) : undefined;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center px-4">
        <Link href="/overview" onClick={onNavigate} className="rounded-sm">
          <Logo />
        </Link>
      </div>

      <nav aria-label="Main" className="flex-1 overflow-y-auto px-2 pb-4">
        <ul className="flex flex-col gap-0.5">
          {GLOBAL_NAV.map((item) => (
            <li key={item.href}>
              <NavLink item={item} pathname={pathname} onNavigate={onNavigate} />
            </li>
          ))}
        </ul>

        {site ? (
          <div className="mt-6 border-t border-line pt-4">
            <div className="mb-2 px-2">
              <p className="truncate text-[13px] leading-5 font-medium text-ink">{site.name}</p>
              <p className="truncate font-mono text-[11px] leading-4 text-ink-3">{site.hostname}</p>
            </div>
            {siteNav(site.id).map((group, index) => (
              <div key={group.label ?? index} className={group.label ? "mt-6" : index > 0 ? "mt-6" : ""}>
                {group.label ? <p className="mb-2 px-2 text-[12px] leading-4 text-ink-3">{group.label}</p> : null}
                <ul className="flex flex-col gap-0.5">
                  {group.items.map((item) => (
                    <li key={item.href}>
                      <NavLink item={item} pathname={pathname} onNavigate={onNavigate} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : null}
      </nav>

      {demo ? (
        <div className="shrink-0 border-t border-line px-4 py-3">
          <p className="font-mono text-[11px] leading-4 text-warning">Demo data on</p>
          <p className="text-[12px] leading-4 text-ink-3">Synthetic sites are visible</p>
        </div>
      ) : null}
    </div>
  );
}
