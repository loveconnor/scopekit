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
import { Sheet, SheetPopup, SheetTitle } from "@/components/ui/sheet";
import { GLOBAL_NAV, siteNav } from "@/lib/nav";
import { Menu as MenuIcon, Plus, Search } from "honestui/icons";
import { useParams, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { LogoMark } from "./logo";
import { NavIcon } from "./nav-icon";
import { SidebarContent, type ShellSite, type ShellUser } from "./sidebar";

type ShellState = { paletteOpen: boolean; setPaletteOpen: (open: boolean) => void };
const ShellContext = createContext<ShellState>({ paletteOpen: false, setPaletteOpen: () => {} });
export const useShell = () => useContext(ShellContext);

/** Holds the one piece of state the shell shares: whether search is open. ⌘K toggles it from anywhere. */
export function ShellProvider({ children }: { children: ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
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
  const value = useMemo(() => ({ paletteOpen, setPaletteOpen }), [paletteOpen]);
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

/** Searches routes and sites that are already loaded. Opening it never triggers background work. */
export function CommandPalette({ sites }: { sites: ShellSite[] }) {
  const { paletteOpen, setPaletteOpen } = useShell();
  const router = useRouter();
  const params = useParams<{ siteId?: string }>();
  const current = sites.find((s) => s.id === params.siteId);
  const go = (href: string) => {
    setPaletteOpen(false);
    router.push(href);
  };

  return (
    <CommandDialog open={paletteOpen} onOpenChange={setPaletteOpen}>
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
            <CommandGroup>
              <CommandLabel>All websites</CommandLabel>
              {GLOBAL_NAV.map((item) => (
                <CommandItem key={item.href} value={item.label} leadingIcon={<NavIcon name={item.icon} />} onClick={() => go(item.href)}>
                  {item.label}
                </CommandItem>
              ))}
              <CommandItem value="Add website" leadingIcon={<Plus size={16} strokeWidth={1.5} />} onClick={() => go("/sites/new")}>
                Add website
              </CommandItem>
            </CommandGroup>
          </CommandContent>
        </Command>
      </CommandDialogContent>
    </CommandDialog>
  );
}

/** Phones and tablets: a slim bar that says where you are, with the full sidebar one tap away. */
export function MobileBar({ sites, demo, user, openAlerts }: { sites: ShellSite[]; demo: boolean; user: ShellUser; openAlerts: number }) {
  const { setPaletteOpen } = useShell();
  const params = useParams<{ siteId?: string }>();
  const [menuOpen, setMenuOpen] = useState(false);
  const current = sites.find((s) => s.id === params.siteId);

  return (
    <>
      <Button variant="ghost" size="icon-sm" aria-label="Open navigation" onClick={() => setMenuOpen(true)}>
        <MenuIcon size={16} strokeWidth={1.5} />
      </Button>
      <span className="flex min-w-0 items-center gap-2 text-[14px] leading-5 font-medium text-ink">
        <LogoMark className="size-[18px] shrink-0" />
        <span className="truncate">{current ? current.name : "All websites"}</span>
      </span>
      <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label="Search" onClick={() => setPaletteOpen(true)}>
        <Search size={16} strokeWidth={1.5} />
      </Button>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetPopup side="left" className="w-[280px] p-0" showCloseButton={false}>
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarContent sites={sites} demo={demo} user={user} openAlerts={openAlerts} onNavigate={() => setMenuOpen(false)} />
        </SheetPopup>
      </Sheet>
    </>
  );
}
