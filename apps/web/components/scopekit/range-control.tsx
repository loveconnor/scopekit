"use client";

import { DateRangePicker } from "@/components/ui/date-range-picker/date-range-picker";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { saveViewCookie } from "@/lib/params";
import type { RangePreset } from "@scopekit/contracts";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useId, useTransition } from "react";

const toIso = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const fromIso = (value: string) => {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
};

const PRESETS: { value: RangePreset; label: string; hourly?: boolean }[] = [
  { value: "today", label: "Today", hourly: true },
  { value: "24h", label: "24h", hourly: true },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
];

/**
 * Date range and comparison. State lives in the URL, so it survives a reload and can be
 * shared; 7d, 30d and 90d always mean complete days ending yesterday.
 */
export function RangeControl({
  preset,
  from,
  to,
  compare,
  allowHourly = true,
  allowToday = true,
  maxDate,
}: {
  preset: RangePreset;
  from: string;
  to: string;
  compare: boolean;
  allowHourly?: boolean;
  /** Search data lags by days, so its reports offer whole finalized ranges only. */
  allowToday?: boolean;
  /** Last selectable day, as `YYYY-MM-DD`. Defaults to today. */
  maxDate?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const compareId = useId();

  const push = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    next.delete("cursor");
    // The range in the URL may have come from the saved choice; keep it explicit from here on.
    if (!next.has("range") && !patch.range) next.set("range", preset);
    if (next.get("range") === "custom" && !next.has("from")) {
      next.set("from", from);
      next.set("to", to);
    }
    saveViewCookie(next);
    const query = next.toString();
    startTransition(() => router.push(query ? `${pathname}?${query}` : pathname, { scroll: false }));
  };

  return (
    <div className="flex flex-wrap items-center gap-2" data-pending={pending || undefined}>
      <ToggleGroup
        aria-label="Date range"
        size="sm"
        value={preset === "custom" ? [] : [preset]}
        onValueChange={(value) => {
          const next = value[0];
          if (next) push({ range: next, from: null, to: null });
        }}
      >
        {PRESETS.filter((p) => (allowHourly || p.value !== "24h") && (allowToday || !p.hourly)).map((p) => (
          <ToggleGroupItem key={p.value} value={p.value} className="px-2.5 text-[13px]">
            {p.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <div className="w-[232px] [&_[data-slot=date-range-picker-trigger]]:h-8 [&_button]:h-8">
      <DateRangePicker
        aria-label="Custom date range"
        value={{ from: fromIso(from), to: fromIso(to) }}
        maxDate={maxDate ? fromIso(maxDate) : new Date()}
        numberOfMonths={2}
        onValueChange={(range) => {
          if (range?.from && range.to) push({ range: "custom", from: toIso(range.from), to: toIso(range.to) });
        }}
      />
      </div>
      <label htmlFor={compareId} className="flex h-8 cursor-pointer items-center gap-2 pl-1 text-[13px] text-ink-2">
        <Switch id={compareId} checked={compare} onCheckedChange={(checked) => push({ compare: checked ? null : "0" })} />
        Compare
      </label>
    </div>
  );
}
