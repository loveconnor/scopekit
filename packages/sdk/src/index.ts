/** Flat, non-identifying values only. The collector drops anything else. */
export type EventProps = Record<string, string | number | boolean>;

type ScopeKitApi = {
  loaded: boolean;
  track(name: string, props?: EventProps): void;
  pageview(opts?: { path?: string }): void;
  enable(): void;
  disable(): void;
};

declare global {
  interface Window {
    scopekit?: ScopeKitApi;
    __skq?: [keyof ScopeKitApi, unknown[]][];
  }
}

// Calls made before the script loads are queued and replayed in order.
function call(method: "track" | "pageview" | "enable" | "disable", args: unknown[]): void {
  if (typeof window === "undefined") return;
  const api = window.scopekit;
  if (api?.loaded) (api[method] as (...a: unknown[]) => void)(...args);
  else (window.__skq ??= []).push([method, args]);
}

export function track(name: string, props?: EventProps): void {
  call("track", [name, props]);
}

/** Records a pageview for the current URL, or for `path`. Repeats for the same path are ignored. */
export function trackPageview(opts?: { path?: string }): void {
  call("pageview", [opts]);
}

/** Consent mode only: start tracking after the visitor agrees. */
export function enableTracking(): void {
  call("enable", []);
}

export function disableTracking(): void {
  call("disable", []);
}
