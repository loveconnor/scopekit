import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** The product's status vocabulary (spec 18.4), each with a plain-language next step. */
export const STATUS = {
  collecting: { label: "Collecting", tone: "positive", help: "Events are arriving from this site." },
  connected: { label: "Connected", tone: "positive", help: "This integration is working." },
  pending_setup: { label: "Pending setup", tone: "muted", help: "Add the tracking snippet to the site, then verify it." },
  never_received: { label: "Never received", tone: "muted", help: "No event has arrived yet. Check that the snippet is installed." },
  stale: { label: "Stale", tone: "warning", help: "No events for over 24 hours. Check that the snippet is still on the site." },
  disabled: { label: "Disabled", tone: "muted", help: "Tracking is turned off in site settings." },
  syncing: { label: "Syncing", tone: "positive", help: "The worker is fetching data for this property." },
  backfilling: { label: "Backfilling", tone: "positive", help: "Totals are complete. Query and page history is still being fetched." },
  needs_reauth: { label: "Needs reconnecting", tone: "warning", help: "Google access was revoked or expired. Stored data is kept; reconnect to resume syncing." },
  rate_limited: { label: "Rate limited", tone: "warning", help: "Google's quota was reached. The sync retries on its own." },
  healthy: { label: "Healthy", tone: "positive", help: "The last complete crawl found no critical or high issues." },
  needs_attention: { label: "Needs attention", tone: "warning", help: "The last crawl found high-severity issues, or many smaller ones." },
  critical: { label: "Critical", tone: "negative", help: "At least one critical issue is open." },
  insufficient_coverage: { label: "Insufficient coverage", tone: "muted", help: "The last crawl was partial, so the site's health cannot be judged from it." },
  not_run: { label: "No audit yet", tone: "muted", help: "This site has not been crawled." },
  not_connected: { label: "Not connected", tone: "muted", help: "This data source has not been connected." },
  insufficient_data: { label: "Insufficient data", tone: "muted", help: "Not enough data yet to show this." },
  error: { label: "Error", tone: "negative", help: "Something failed. Open Activity for details." },
} as const;
export type StatusKey = keyof typeof STATUS;

const TONES = { positive: "bg-positive", warning: "bg-warning", negative: "bg-negative", muted: "bg-ink-3/50" };

export function StatusBadge({ status, className }: { status: StatusKey; className?: string }) {
  const { label, tone, help } = STATUS[status];
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span tabIndex={0} className={cn("inline-flex cursor-default items-center gap-2 rounded-sm text-[13px] leading-5 text-ink-2", className)} />}
      >
        <span aria-hidden="true" className={cn("size-1.5 rounded-full", TONES[tone])} />
        {label}
      </TooltipTrigger>
      <TooltipPopup className="max-w-[240px] text-[12px] leading-4">{help}</TooltipPopup>
    </Tooltip>
  );
}

/** Collection status from what the site has actually sent. */
export function siteStatus(
  site: { status: string; lastEventAt: Date | string | null; trackingEnabled?: boolean },
  now: number,
): StatusKey {
  if (site.trackingEnabled === false || site.status === "disabled") return "disabled";
  if (!site.lastEventAt) return site.status === "pending_setup" ? "pending_setup" : "never_received";
  const last = typeof site.lastEventAt === "string" ? Date.parse(site.lastEventAt) : site.lastEventAt.getTime();
  return now - last > 24 * 60 * 60 * 1000 ? "stale" : "collecting";
}
