/**
 * ScopeKit tracker. Built as a single IIFE and served by the collector at /script.js.
 *
 * Rules it lives by: never throw into the host page, never block rendering, never read
 * form values, text content or full query strings, and never store anything long-lived
 * unless the site runs in consent mode and has called `scopekit.enable()`.
 */
(function () {
  try {
    const w = window as unknown as Window & { scopekit?: Record<string, unknown>; __skq?: [string, unknown[]][] };
    const d = document;
    if (w.scopekit && w.scopekit.loaded) return;

    const el = (d.currentScript || d.querySelector("script[data-site]")) as HTMLScriptElement | null;
    const site = el && el.getAttribute("data-site");
    if (!el || !site) return;

    const endpoint = el.getAttribute("data-api") || new URL(el.src).origin + "/api/collect";
    const consentMode = el.getAttribute("data-mode") === "consent";
    const allowedQuery = (el.getAttribute("data-query") || "").split(",").filter(Boolean);
    const trackOutbound = el.hasAttribute("data-outbound");
    const trackDownloads = el.hasAttribute("data-downloads");

    const MAX_QUEUE = 20;
    const IDLE_MS = 120000;
    const VISITOR_COOKIE = "sk_v";

    let enabled = !consentMode;
    let queue: Record<string, unknown>[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let lastPath: string | null = null;
    let firstPageview = true;
    let visibleSince = 0;
    let engagedMs = 0;
    let lastActivity = Date.now();
    let memorySession = "";

    const token = () => {
      const bytes = crypto.getRandomValues(new Uint8Array(12));
      let out = "";
      for (let i = 0; i < bytes.length; i++) out += (bytes[i]! % 36).toString(36);
      return out;
    };

    const uuidv7 = () => {
      const b = crypto.getRandomValues(new Uint8Array(16));
      let t = Date.now();
      for (let i = 5; i >= 0; i--) {
        b[i] = t % 256;
        t = Math.floor(t / 256);
      }
      b[6] = (b[6]! & 15) | 112;
      b[8] = (b[8]! & 63) | 128;
      let hex = "";
      for (let i = 0; i < 16; i++) hex += (b[i]! + 256).toString(16).slice(1);
      return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" + hex.slice(16, 20) + "-" + hex.slice(20);
    };

    // A tab-scoped session. Storage-restricted browsers fall back to a per-page-load session.
    const sessionId = () => {
      try {
        let id = sessionStorage.getItem("sk_s");
        if (!id) sessionStorage.setItem("sk_s", (id = token()));
        return id;
      } catch {
        return memorySession || (memorySession = token());
      }
    };

    const readVisitor = () => {
      const match = d.cookie.match(/(?:^|; )sk_v=([A-Za-z0-9_-]{8,64})/);
      return match ? match[1]! : null;
    };
    const visitorId = () => {
      if (!consentMode || !enabled) return undefined;
      let id = readVisitor();
      if (!id) {
        id = token() + token();
        d.cookie = VISITOR_COOKIE + "=" + id + "; path=/; max-age=34128000; samesite=lax" + (location.protocol === "https:" ? "; secure" : "");
      }
      return id;
    };

    const currentPath = () => {
      let path = location.pathname;
      if (allowedQuery.length) {
        const all = new URLSearchParams(location.search);
        const keep = new URLSearchParams();
        for (const key of allowedQuery) for (const value of all.getAll(key)) keep.append(key, value);
        const qs = keep.toString();
        if (qs) path += "?" + qs;
      }
      return path;
    };

    const send = (batch: Record<string, unknown>[], beacon: boolean) => {
      const body = JSON.stringify(batch);
      if (beacon && navigator.sendBeacon && navigator.sendBeacon(endpoint, body)) return;
      fetch(endpoint, {
        method: "POST",
        body,
        keepalive: true,
        credentials: "omit",
        headers: { "content-type": "text/plain" },
      })
        .then((res) => {
          if (res.status >= 500 || res.status === 429) retry(batch);
          else failures = 0;
        })
        .catch(() => retry(batch));
    };

    // Failed batches go back in front; under repeated failure the oldest events are dropped.
    const retry = (batch: Record<string, unknown>[]) => {
      failures++;
      queue = batch.concat(queue).slice(-MAX_QUEUE);
      if (failures <= 5) schedule(Math.min(30000, 1000 * Math.pow(2, failures)));
    };

    const flush = (beacon?: boolean) => {
      clearTimeout(flushTimer);
      flushTimer = undefined;
      if (!enabled || !queue.length) return;
      const batch = queue;
      queue = [];
      send(batch, !!beacon);
    };

    const schedule = (delay: number) => {
      if (!flushTimer) flushTimer = setTimeout(flush, delay);
    };

    const push = (type: string, path: string, extra?: Record<string, unknown>) => {
      if (!enabled) return;
      const event: Record<string, unknown> = {
        v: 1,
        site,
        id: uuidv7(),
        type,
        occurredAt: new Date().toISOString(),
        path,
        sessionId: sessionId(),
      };
      const visitor = visitorId();
      if (visitor) event.visitorId = visitor;
      if (extra) for (const key in extra) event[key] = extra[key];
      queue.push(event);
      if (queue.length > MAX_QUEUE) queue.shift();
      if (queue.length >= 10) flush();
      else schedule(600);
    };

    const pageview = (opts?: { path?: string }) => {
      if (!enabled) return;
      const path = (opts && opts.path) || currentPath();
      // Covers replaceState to the same URL, framework double-fires and Strict Mode remounts.
      if (path === lastPath) return;
      lastPath = path;
      const params = new URLSearchParams(location.search);
      const extra: Record<string, unknown> = {
        utm: { source: params.get("utm_source"), medium: params.get("utm_medium"), campaign: params.get("utm_campaign") },
      };
      // Only the landing pageview carries the external referrer; later ones are in-site navigations.
      if (firstPageview && d.referrer) extra.referrer = d.referrer;
      firstPageview = false;
      push("pageview", path, extra);
    };

    const track = (name: string, props?: Record<string, unknown>) => {
      if (typeof name !== "string" || !name) return;
      push("custom", lastPath || currentPath(), { name, props: props || {} });
    };

    // Engagement: visible time while the visitor is not idle, reported in small increments.
    const settle = () => {
      const now = Date.now();
      if (visibleSince) {
        const activeUntil = Math.min(now, lastActivity + IDLE_MS);
        if (activeUntil > visibleSince) engagedMs += activeUntil - visibleSince;
        visibleSince = now;
      }
    };
    const reportEngagement = () => {
      settle();
      if (engagedMs >= 1000 && lastPath) {
        push("engagement", lastPath, { engagedMs: Math.round(engagedMs) });
        engagedMs = 0;
      }
    };

    const onVisibility = () => {
      if (d.visibilityState === "visible") {
        visibleSince = lastActivity = Date.now();
        if (lastPath === null) pageview();
      } else {
        reportEngagement();
        visibleSince = 0;
        flush(true);
      }
    };

    const onClick = (e: MouseEvent) => {
      try {
        const target = e.target as Element | null;
        const link = target && target.closest ? (target.closest("a[href]") as HTMLAnchorElement | null) : null;
        if (!link || !/^https?:$/.test(link.protocol)) return;
        if (trackDownloads && /\.(pdf|zip|dmg|exe|csv|xlsx?|docx?|pptx?|mp3|mp4|gz|tar|rar|7z|pkg|apk)$/i.test(link.pathname)) {
          push("download", lastPath || currentPath(), { props: { file: link.pathname.slice(0, 200) } });
        } else if (trackOutbound && link.host !== location.host) {
          push("outbound_click", lastPath || currentPath(), { props: { url: (link.origin + link.pathname).slice(0, 200) } });
        }
      } catch {}
    };

    const api = {
      loaded: true,
      track,
      pageview,
      /** Consent mode: call after the visitor agrees. Nothing is sent or stored before this. */
      enable() {
        if (enabled) return;
        enabled = true;
        if (d.visibilityState === "visible") onVisibility();
      },
      /** Stops tracking and removes the consent-mode visitor ID. */
      disable() {
        enabled = false;
        queue = [];
        d.cookie = VISITOR_COOKIE + "=; path=/; max-age=0";
      },
    };

    // History instrumentation for single-page navigations.
    const wrap = (method: "pushState" | "replaceState") => {
      const original = history[method];
      history[method] = function (this: History, ...args: Parameters<History["pushState"]>) {
        const result = original.apply(this, args);
        try {
          setTimeout(pageview, 0);
        } catch {}
        return result;
      } as History["pushState"];
    };
    wrap("pushState");
    wrap("replaceState");
    addEventListener("popstate", () => setTimeout(pageview, 0));

    d.addEventListener("visibilitychange", onVisibility);
    addEventListener("pagehide", () => {
      reportEngagement();
      flush(true);
    });
    const active = () => {
      lastActivity = Date.now();
    };
    for (const type of ["pointerdown", "keydown", "scroll"]) addEventListener(type, active, { passive: true, capture: true });
    setInterval(() => {
      if (visibleSince && Date.now() - lastActivity < IDLE_MS) reportEngagement();
    }, 60000);
    if (trackOutbound || trackDownloads) d.addEventListener("click", onClick, true);

    const queued = w.__skq || [];
    w.scopekit = api;
    if (d.visibilityState === "visible") onVisibility();
    for (const [method, args] of queued) {
      const fn = (api as unknown as Record<string, (...a: unknown[]) => void>)[method];
      if (typeof fn === "function") fn(...args);
    }
  } catch {
    // Analytics must never break the host page.
  }
})();
