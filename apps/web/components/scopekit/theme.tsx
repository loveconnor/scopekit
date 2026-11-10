"use client";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useState, useSyncExternalStore } from "react";

export type ThemeChoice = "system" | "light" | "dark";

export function applyTheme(choice: ThemeChoice) {
  try {
    localStorage.setItem("sk-theme", choice);
  } catch {}
  const dark = choice === "dark" || (choice === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.classList.toggle("dark", dark);
}

/** Appearance setting: stored in the browser for a flash-free load and on the account for other devices. */
export function ThemeSetting({ initial }: { initial: ThemeChoice }) {
  // This browser's saved choice wins over the account default, matching the inline theme script.
  const saved = useSyncExternalStore(
    () => () => {},
    () => {
      try {
        return localStorage.getItem("sk-theme") as ThemeChoice | null;
      } catch {
        return null;
      }
    },
    () => null,
  );
  const [picked, setChoice] = useState<ThemeChoice | null>(null);
  const choice = picked ?? saved ?? initial;

  return (
    <ToggleGroup
      aria-label="Appearance"
      value={[choice]}
      onValueChange={(value) => {
        const next = value[0] as ThemeChoice | undefined;
        if (!next) return;
        setChoice(next);
        applyTheme(next);
        void fetch("/api/preferences", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ theme: next }),
        });
      }}
    >
      <ToggleGroupItem value="system">System</ToggleGroupItem>
      <ToggleGroupItem value="light">Light</ToggleGroupItem>
      <ToggleGroupItem value="dark">Dark</ToggleGroupItem>
    </ToggleGroup>
  );
}
