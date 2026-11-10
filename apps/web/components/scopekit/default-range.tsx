"use client";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function DefaultRangeSetting({ initial }: { initial: "7d" | "30d" | "90d" }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  return (
    <ToggleGroup
      aria-label="Default date range"
      value={[value]}
      onValueChange={async (next) => {
        const choice = next[0] as typeof initial | undefined;
        if (!choice) return;
        setValue(choice);
        await fetch("/api/preferences", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ defaultRange: choice }),
        });
        router.refresh();
      }}
    >
      <ToggleGroupItem value="7d">7 days</ToggleGroupItem>
      <ToggleGroupItem value="30d">30 days</ToggleGroupItem>
      <ToggleGroupItem value="90d">90 days</ToggleGroupItem>
    </ToggleGroup>
  );
}
