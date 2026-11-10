"use client";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandContent,
  CommandDialog,
  CommandDialogContent,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandLabel,
} from "@/components/ui/command";
import { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetPopup, SheetTitle } from "@/components/ui/sheet";
import { authClient } from "@/lib/auth-client";
import { GLOBAL_NAV, siteNav } from "@/lib/nav";
import { Check, ChevronsUpDown, Menu as MenuIcon, Plus, Search } from "honestui/icons";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { NavIcon } from "./nav-icon";
import { SidebarContent, type ShellSite } from "./sidebar";

function Keycap({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-[4px] border border-line bg-surface px-1 font-mono text-[11px] leading-none text-ink-3">
      {children}
    </kbd>
  );
}

function SiteSwitcher({ sites }: { sites: ShellSite[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams<{ siteId?: string }>();
  const [open, setOpen] = useState(false);
  const current = sites.find((s) => s.id === params.siteId);

  const go = (siteId: string | null) => {
    setOpen(false);
    if (!siteId) return router.push("/overview");
    // Stay on the same report when switching between sites.
    const rest = current ? pathname.slice(`/sites/${current.id}`.length) : "/overview";
    router.push(`/sites/${siteId}${rest || "/overview"}`);
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
          <Button variant="outline" size="sm" className="h-8 max-w-[240px] justify-between gap-2 px-2.5" aria-label="Switch website" />
        }
      >
        <span className="truncate">{current ? current.name : "All websites"}</span>
        <ChevronsUpDown size={14} strokeWidth={1.5} className="shrink-0 text-ink-3" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverPopup align="start" sideOffset={6} className="w-[280px] p-0">
        <Command>
          <CommandInput placeholder="Search websites" size="sm" />
          <CommandContent className="max-h-[320px]">
            <CommandEmpty>No website matches</CommandEmpty>
            <CommandGroup>
              <CommandItem value="All websites" onClick={() => go(null)} trailingIcon={!current ? <Check size={16} strokeWidth={1.5} /> : undefined}>
                All websites
              </CommandItem>
              {sites.map((site) => (
                <CommandItem
                  key={site.id}
                  value={`${site.name} ${site.hostname}`}
                  onClick={() => go(site.id)}
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
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                router.push("/sites/new");
              }}
              className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] text-ink-2 transition-colors duration-150 ease-out hover:bg-raised hover:text-ink"
            >
              <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
              Add website
            </button>
          </div>
        </Command>
      </PopoverPopup>
    </Popover>
  );
}

/** Searches routes and sites that are already loaded. Opening it never triggers background work. */
function CommandPalette({ sites, open, onOpenChange }: { sites: ShellSite[]; open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const params = useParams<{ siteId?: string }>();
  const current = sites.find((s) => s.id === params.siteId);
  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandDialogContent title="Go to">
        <Command>
          <CommandInput placeholder="Search pages and websites" />
          <CommandContent>
            <CommandEmpty>Nothing matches</CommandEmpty>
            {current ? (
              <CommandGroup>
                <CommandLabel>{current.name}</CommandLabel>
                {siteNav(current.id)
                  .flatMap((group) => group.items.map((item) => ({ ...item, group: group.label })))
                  .map((item) => (
                    <CommandItem
                      key={item.href}
                      value={`${item.group ?? ""} ${item.label}`}
                      leadingIcon={<NavIcon name={item.icon} />}
                      onClick={() => go(item.href)}
                    >
                      {item.group ? `${item.group}: ${item.label}` : item.label}
                    </CommandItem>
                  ))}
              </CommandGroup>
            ) : null}
            <CommandGroup>
              <CommandLabel>ScopeKit</CommandLabel>
              {GLOBAL_NAV.map((item) => (
                <CommandItem key={item.href} value={item.label} leadingIcon={<NavIcon name={item.icon} />} onClick={() => go(item.href)}>
                  {item.label}
                </CommandItem>
              ))}
              <CommandItem value="Add website" leadingIcon={<Plus size={16} strokeWidth={1.5} />} onClick={() => go("/sites/new")}>
                Add website
              </CommandItem>
            </CommandGroup>
            {sites.length ? (
              <CommandGroup>
                <CommandLabel>Websites</CommandLabel>
                {sites.map((site) => (
                  <CommandItem
                    key={site.id}
                    value={`${site.name} ${site.hostname}`}
                    leadingIcon={<NavIcon name="sites" />}
                    onClick={() => go(`/sites/${site.id}/overview`)}
                  >
                    {site.name}
                    <span className="ml-2 font-mono text-[11px] text-ink-3">{site.hostname}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </CommandContent>
        </Command>
      </CommandDialogContent>
    </CommandDialog>
  );
}

export function Header({ sites, demo, user }: { sites: ShellSite[]; demo: boolean; user: { email: string; name: string } }) {
  const router = useRouter();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const initial = (user.name || user.email).trim().charAt(0).toUpperCase();

  return (
    <>
      <Button variant="ghost" size="icon-sm" className="lg:hidden" aria-label="Open navigation" onClick={() => setMenuOpen(true)}>
        <MenuIcon size={16} strokeWidth={1.5} />
      </Button>
      <SiteSwitcher sites={sites} />

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="flex h-8 cursor-pointer items-center gap-2 rounded-md border border-line bg-surface pr-1.5 pl-2.5 text-[13px] text-ink-3 transition-colors duration-150 ease-out hover:text-ink-2 sm:w-[220px]"
        >
          <Search size={16} strokeWidth={1.5} aria-hidden="true" />
          <span className="hidden flex-1 text-left sm:inline">Search</span>
          <span className="hidden items-center gap-1 sm:flex" aria-hidden="true">
            <Keycap>⌘</Keycap>
            <Keycap>K</Keycap>
          </span>
          <span className="sr-only">Open command palette</span>
        </button>

        <Menu>
          <MenuTrigger
            render={
              <button
                type="button"
                aria-label="Account"
                className="flex size-8 cursor-pointer items-center justify-center rounded-full border border-line bg-surface text-[13px] font-medium text-ink-2 transition-colors duration-150 ease-out hover:text-ink"
              />
            }
          >
            {initial}
          </MenuTrigger>
          <MenuPopup align="end" sideOffset={6} className="min-w-[220px]">
            {/* Base UI only allows a group label inside a group. */}
            <MenuGroup>
              <MenuGroupLabel className="font-mono text-[11px] text-ink-3">{user.email}</MenuGroupLabel>
              <MenuSeparator />
              <MenuItem onClick={() => router.push("/settings")}>Settings</MenuItem>
              <MenuItem onClick={() => router.push("/activity")}>Activity</MenuItem>
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
      </div>

      <CommandPalette sites={sites} open={paletteOpen} onOpenChange={setPaletteOpen} />

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetPopup side="left" className="w-[264px] p-0" showCloseButton={false}>
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarContent sites={sites} demo={demo} onNavigate={() => setMenuOpen(false)} />
        </SheetPopup>
      </Sheet>
    </>
  );
}
