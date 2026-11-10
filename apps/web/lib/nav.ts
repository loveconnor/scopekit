export type NavItem = { label: string; href: string; icon: string; exact?: boolean };
export type NavGroup = { label: string | null; items: NavItem[] };

export const GLOBAL_NAV: NavItem[] = [
  { label: "Overview", href: "/overview", icon: "overview" },
  { label: "Websites", href: "/sites", icon: "sites", exact: true },
  { label: "Alerts", href: "/alerts", icon: "alerts" },
  { label: "Activity", href: "/activity", icon: "activity" },
  { label: "Settings", href: "/settings", icon: "settings" },
];

export function siteNav(siteId: string): NavGroup[] {
  const base = `/sites/${siteId}`;
  return [
    { label: null, items: [{ label: "Overview", href: `${base}/overview`, icon: "overview" }] },
    {
      label: "Analytics",
      items: [
        { label: "Traffic", href: `${base}/analytics`, icon: "traffic", exact: true },
        { label: "Pages", href: `${base}/analytics/pages`, icon: "pages" },
        { label: "Sources", href: `${base}/analytics/sources`, icon: "sources" },
        { label: "Events and goals", href: `${base}/analytics/events`, icon: "events" },
        { label: "Realtime", href: `${base}/analytics/realtime`, icon: "realtime" },
      ],
    },
    {
      label: "SEO",
      items: [
        { label: "Search performance", href: `${base}/seo/search`, icon: "search" },
        { label: "Queries", href: `${base}/seo/queries`, icon: "queries" },
        { label: "Pages", href: `${base}/seo/pages`, icon: "pages" },
        { label: "Opportunities", href: `${base}/seo/opportunities`, icon: "opportunities" },
        { label: "Tracked keywords", href: `${base}/seo/keywords`, icon: "keywords" },
        { label: "Indexing", href: `${base}/seo/indexing`, icon: "indexing" },
      ],
    },
    {
      label: "Health",
      items: [
        { label: "Site audit", href: `${base}/audit`, icon: "audit" },
        { label: "Performance", href: `${base}/performance`, icon: "performance" },
      ],
    },
    { label: null, items: [{ label: "Site settings", href: `${base}/settings`, icon: "settings" }] },
  ];
}

export function isActive(pathname: string, item: NavItem): boolean {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}
