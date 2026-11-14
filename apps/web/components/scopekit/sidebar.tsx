"use client";

import { Command, CommandContent, CommandEmpty, CommandGroup, CommandInput, CommandItem } from "@/components/ui/command";
import { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "@/components/ui/popover";
import { authClient } from "@/lib/auth-client";
import { isActive, siteNav, type NavItem } from "@/lib/nav";
import { RANGE_KEYS } from "@/lib/params";
import { cn } from "@/lib/utils";
import { Check, ChevronsUpDown, Plus, Search } from "honestui/icons";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import { LogoMark } from "./logo";
import { NavIcon } from "./nav-icon";
import { useShell } from "./shell";

export type ShellSite = { id: string; name: string; hostname: string; isDemo: boolean };
export type ShellUser = { email: string; name: string };

/** With every site listed in the sidebar this stops being a shortcut, so the list is capped and the rest sit behind "All websites". */
const MAX_LISTED_SITES = 8;

/** Always in the same place, whichever website is open. */
const WORKSPACE_NAV: NavItem[] = [
  { label: "Alerts", href: "/alerts", icon: "alerts" },
  { label: "Activity", href: "/activity", icon: "activity" },
  { label: "Settings", href: "/settings", icon: "settings" },
];

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

const ROW = "flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] leading-5 transition-colors duration-150 ease-out lg:h-7";
const ROW_IDLE = "text-ink-2 hover:bg-ink/[0.04] hover:text-ink";
const ROW_ACTIVE = "bg-ink/[0.07] font-medium text-ink";

function NavLink({ item, pathname, onNavigate, trailing }: { item: NavItem; pathname: string; onNavigate?: () => void; trailing?: ReactNode }) {
  const active = isActive(pathname, item);
  const href = useCarriedQuery(item.href, pathname);
  return (
    <Link href={href} onClick={onNavigate} aria-current={active ? "page" : undefined} className={cn(ROW, active ? ROW_ACTIVE : ROW_IDLE)}>
      <NavIcon name={item.icon} className={cn("shrink-0", active ? "text-ink" : "text-ink-3")} />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {trailing}
    </Link>
  );
}

function GroupLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-1 flex h-6 items-center justify-between pr-1 pl-2">
      <p className="text-[12px] leading-4 text-ink-3">{children}</p>
      {action}
    </div>
  );
}

/** The scope control: everything below it in the sidebar belongs to whatever it shows. */
function SiteSwitcher({ sites, onNavigate }: { sites: ShellSite[]; onNavigate?: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams<{ siteId?: string }>();
  const [open, setOpen] = useState(false);
  const current = sites.find((s) => s.id === params.siteId);

  const go = (href: string) => {
    setOpen(false);
    onNavigate?.();
    router.push(href);
  };
  const goSite = (siteId: string) => {
    // Stay on the same report when switching between sites.
    const rest = current ? pathname.slice(`/sites/${current.id}`.length) : "/overview";
    go(`/sites/${siteId}${rest || "/overview"}`);
    void fetch("/api/preferences", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lastSiteId: siteId }),
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label="Switch website"
            className="flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-md px-2 text-left transition-colors duration-150 ease-out hover:bg-ink/[0.04] data-[popup-open]:bg-ink/[0.04]"
          />
        }
      >
        <LogoMark className="shrink-0 text-ink" />
        <span className="min-w-0 flex-1 truncate text-[14px] leading-5 font-medium text-ink">{current ? current.name : "All websites"}</span>
        <ChevronsUpDown size={14} strokeWidth={1.5} className="shrink-0 text-ink-3" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverPopup align="start" sideOffset={6} className="w-[264px] p-0">
        <Command>
          <CommandInput placeholder="Search websites" size="sm" />
          <CommandContent className="max-h-[320px]">
            <CommandEmpty>No website matches</CommandEmpty>
            <CommandGroup>
              <CommandItem value="All websites" onClick={() => go("/overview")} trailingIcon={!current ? <Check size={16} strokeWidth={1.5} /> : undefined}>
                All websites
              </CommandItem>
              {sites.map((site) => (
                <CommandItem
                  key={site.id}
                  value={`${site.name} ${site.hostname}`}
                  onClick={() => goSite(site.id)}
                  trailingIcon={site.id === current?.id ? <Check size={16} strokeWidth={1.5} /> : undefined}
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{site.name}</span>
                    <span className="truncate font-mono text-[11px] leading-4 text-ink-3">
                      {site.hostname}
                      {site.isDemo ? " · demo" : ""}
                    </span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandContent>
          <div className="border-t border-line p-1">
            <button type="button" onClick={() => go("/sites/new")} className={cn(ROW, ROW_IDLE, "w-full cursor-pointer lg:h-8")}>
              <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
              Add website
            </button>
          </div>
        </Command>
      </PopoverPopup>
    </Popover>
  );
}

function AccountMenu({ user, onNavigate }: { user: ShellUser; onNavigate?: () => void }) {
  const router = useRouter();
  const label = user.name || user.email;
  return (
    <Menu>
      <MenuTrigger
        render={
          <button
            type="button"
            aria-label="Account"
            className="flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-md px-2 text-left transition-colors duration-150 ease-out hover:bg-ink/[0.04] data-[popup-open]:bg-ink/[0.04]"
          />
        }
      >
        <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center rounded-full bg-ink text-[11px] leading-none font-medium text-on-strong">
          {label.trim().charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] leading-5 text-ink-2">{label}</span>
        <ChevronsUpDown size={14} strokeWidth={1.5} className="shrink-0 text-ink-3" aria-hidden="true" />
      </MenuTrigger>
      <MenuPopup align="start" sideOffset={6} className="min-w-[216px]">
        {/* Base UI only allows a group label inside a group. */}
        <MenuGroup>
          <MenuGroupLabel className="font-mono text-[11px] text-ink-3">{user.email}</MenuGroupLabel>
          <MenuSeparator />
          <MenuItem
            onClick={() => {
              onNavigate?.();
              router.push("/settings");
            }}
          >
            Settings
          </MenuItem>
        </MenuGroup>
        <MenuSeparator />
        <MenuItem
          onClick={async () => {
            await authClient.signOut();
            router.push("/login");
            router.refresh();
          }}
        >
          Sign out
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}

/**
 * One column, read top to bottom: which website, search, that website's reports, then the
 * things that are the same everywhere (alerts, activity, settings, account).
 */
export function SidebarContent({
  sites,
  demo,
  user,
  openAlerts,
  onNavigate,
}: {
  sites: ShellSite[];
  demo: boolean;
  user: ShellUser;
  openAlerts: number;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const params = useParams<{ siteId?: string }>();
  const { setPaletteOpen } = useShell();
  const site = params.siteId ? sites.find((s) => s.id === params.siteId) : undefined;

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-col gap-2 px-2 pt-2.5 pb-3">
        <SiteSwitcher sites={sites} onNavigate={onNavigate} />
        <button
          type="button"
          onClick={() => {
            onNavigate?.();
            setPaletteOpen(true);
          }}
          className="flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-md border border-line bg-surface pr-1.5 pl-2 text-[13px] text-ink-3 transition-colors duration-150 ease-out hover:text-ink-2"
        >
          <Search size={16} strokeWidth={1.5} className="shrink-0" aria-hidden="true" />
          <span className="flex-1 text-left">Search</span>
          <kbd aria-hidden="true" className="font-mono text-[11px] leading-none text-ink-3">
            ⌘K
          </kbd>
          <span className="sr-only">Open command palette</span>
        </button>
      </div>

      <nav aria-label={site ? site.name : "All websites"} className="flex-1 overflow-y-auto px-2 pb-4">
        {site ? (
          siteNav(site.id).map((group, index) => (
            <div key={group.label ?? index} className={index > 0 ? "mt-4" : undefined}>
              {group.label ? <GroupLabel>{group.label}</GroupLabel> : null}
              <ul className="flex flex-col gap-px">
                {group.items.map((item) => (
                  <li key={item.href}>
                    <NavLink item={item} pathname={pathname} onNavigate={onNavigate} />
                  </li>
                ))}
              </ul>
            </div>
          ))
        ) : (
          <>
            <ul className="flex flex-col gap-px">
              <li>
                <NavLink item={{ label: "Overview", href: "/overview", icon: "overview" }} pathname={pathname} onNavigate={onNavigate} />
              </li>
            </ul>
            <div className="mt-4">
              <GroupLabel
                action={
                  <Link
                    href="/sites/new"
                    onClick={onNavigate}
                    aria-label="Add website"
                    title="Add website"
                    className="flex size-6 items-center justify-center rounded-md text-ink-3 transition-colors duration-150 ease-out hover:bg-ink/[0.04] hover:text-ink"
                  >
                    <Plus size={14} strokeWidth={1.5} aria-hidden="true" />
                  </Link>
                }
              >
                Websites
              </GroupLabel>
              <ul className="flex flex-col gap-px">
                {sites.slice(0, MAX_LISTED_SITES).map((s) => (
                  <li key={s.id}>
                    <Link href={`/sites/${s.id}/overview`} onClick={onNavigate} className={cn(ROW, ROW_IDLE)} title={s.hostname}>
                      <NavIcon name="sites" className="shrink-0 text-ink-3" />
                      <span className="min-w-0 flex-1 truncate">{s.name}</span>
                    </Link>
                  </li>
                ))}
                <li>
                  <NavLink
                    item={{ label: sites.length > MAX_LISTED_SITES ? `All ${sites.length} websites` : "Compare websites", href: "/sites", icon: "audit", exact: true }}
                    pathname={pathname}
                    onNavigate={onNavigate}
                  />
                </li>
              </ul>
            </div>
          </>
        )}
      </nav>

      <div className="shrink-0 border-t border-line px-2 pt-2 pb-2">
        <ul className="flex flex-col gap-px">
          {WORKSPACE_NAV.map((item) => (
            <li key={item.href}>
              <NavLink
                item={item}
                pathname={pathname}
                onNavigate={onNavigate}
                trailing={
                  item.href === "/alerts" && openAlerts > 0 ? (
                    <span className="tnum rounded-full bg-ink/[0.07] px-1.5 text-[11px] leading-4 font-medium text-ink-2">
                      {openAlerts}
                      <span className="sr-only"> open</span>
                    </span>
                  ) : null
                }
              />
            </li>
          ))}
        </ul>
        <div className="mt-2 border-t border-line pt-2">
          <AccountMenu user={user} onNavigate={onNavigate} />
          {demo ? <p className="px-2 pt-1 pb-0.5 font-mono text-[11px] leading-4 text-ink-3">Demo data on</p> : null}
        </div>
      </div>
    </div>
  );
}
