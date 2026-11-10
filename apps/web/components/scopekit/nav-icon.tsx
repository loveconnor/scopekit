import {
  Activity,
  Bell,
  ChartLine,
  Database,
  FileText,
  Gauge,
  Globe,
  KeyRound,
  LayoutDashboard,
  Lightbulb,
  ListChecks,
  MousePointerClick,
  Radio,
  ScanSearch,
  Search,
  Settings,
  Share2,
} from "honestui/icons";
import type { ComponentType } from "react";

const ICONS: Record<string, ComponentType<{ size?: number | string; strokeWidth?: number; className?: string }>> = {
  overview: LayoutDashboard,
  sites: Globe,
  alerts: Bell,
  activity: Activity,
  settings: Settings,
  traffic: ChartLine,
  pages: FileText,
  sources: Share2,
  events: MousePointerClick,
  realtime: Radio,
  search: Search,
  queries: ScanSearch,
  opportunities: Lightbulb,
  keywords: KeyRound,
  indexing: Database,
  audit: ListChecks,
  performance: Gauge,
};

/** One icon set, one size, one stroke. Icons take the color of the text they sit beside. */
export function NavIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? Globe;
  return <Icon size={16} strokeWidth={1.5} className={className} aria-hidden="true" />;
}
