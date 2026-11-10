import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import zlib from "node:zlib";

export const CRAWLER_USER_AGENT = "ScopeKitBot/1.0 (site audit run by the site owner)";

/** Where the crawler may connect. Everything not listed here is refused. */
export type NetPolicy = {
  /** Hostnames (or host:port) the site owner confirmed. Redirects elsewhere are recorded, not followed. */
  allowedHosts: ReadonlySet<string>;
  /** Loopback only, for the fixture server in tests. Private networks are never allowed. */
  allowLoopback?: boolean;
};

const V4_BLOCKED: [number, number][] = (
  [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    // Link-local, which includes cloud metadata services at 169.254.169.254.
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
  ] as const
).map(([base, bits]) => [v4ToInt(base), bits]);

function v4ToInt(ip: string): number {
  return ip.split(".").reduce((n, part) => n * 256 + Number(part), 0);
}

function v6Groups(ip: string): number[] | null {
  let text = ip.split("%")[0]!;
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted) {
    const n = v4ToInt(dotted[1]!);
    text = `${text.slice(0, dotted.index)}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [head, tail] = text.split("::");
  const left = head ? head.split(":") : [];
  const right = tail !== undefined && tail ? tail.split(":") : [];
  if (tail === undefined && left.length !== 8) return null;
  const fill = 8 - left.length - right.length;
  if (fill < 0) return null;
  const groups = [...left, ...Array<string>(tail === undefined ? 0 : fill).fill("0"), ...right].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => g >= 0 && g <= 0xffff) ? groups : null;
}

/** True for addresses on the public internet. Private, loopback, link-local, metadata and reserved ranges are not. */
export function isPublicAddress(ip: string, opts: { allowLoopback?: boolean } = {}): boolean {
  const family = isIP(ip);
  if (family === 4) {
    const n = v4ToInt(ip);
    if (opts.allowLoopback && n >>> 24 === 127) return true;
    return !V4_BLOCKED.some(([base, bits]) => n >>> (32 - bits) === base >>> (32 - bits));
  }
  if (family === 6) {
    const g = v6Groups(ip);
    if (!g) return false;
    const embedded = `${g[6]! >>> 8}.${g[6]! & 255}.${g[7]! >>> 8}.${g[7]! & 255}`;
    // IPv4-mapped and NAT64 addresses are judged by the IPv4 address inside them.
    if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return isPublicAddress(embedded, opts);
    if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isPublicAddress(embedded, opts);
    if (g.slice(0, 7).every((x) => x === 0)) return g[7] === 1 ? !!opts.allowLoopback : false;
    if ((g[0]! & 0xfe00) === 0xfc00) return false; // unique local
    if ((g[0]! & 0xffc0) === 0xfe80) return false; // link-local
    if ((g[0]! & 0xff00) === 0xff00) return false; // multicast
    if (g[0] === 0x2001 && g[1] === 0xdb8) return false; // documentation
    return true;
  }
  return false;
}

export type UrlVerdict = "ok" | "bad_protocol" | "credentials" | "bad_port" | "offsite" | "blocked_address";

/** Checks a URL before any connection is made. The resolved address is checked again at connect time. */
export function checkUrl(raw: string, policy: NetPolicy): UrlVerdict {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "bad_protocol";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "bad_protocol";
  if (url.username || url.password) return "credentials";
  const listed = policy.allowedHosts.has(url.host.toLowerCase());
  // A non-default port is only reachable when the owner listed that exact host:port.
  if (url.port && !listed) return policy.allowedHosts.has(url.hostname.toLowerCase()) ? "bad_port" : "offsite";
  if (!listed && !policy.allowedHosts.has(url.hostname.toLowerCase())) return "offsite";
  const literal = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(literal) && !isPublicAddress(literal, policy)) return "blocked_address";
  return "ok";
}

export type HopResponse = {
  status: number;
  headers: Record<string, string>;
  /** Decompressed body, when the caller asked for it and it was textual. */
  body: Buffer | null;
  /** The body was cut at the size cap. */
  truncated: boolean;
  ms: number;
};

export type FetchFailure = "timeout" | "network" | "blocked_address" | "bad_protocol" | "credentials" | "bad_port";

export type RequestOptions = { timeoutMs: number; maxBytes: number; wantBody: (contentType: string, status: number) => boolean };

/** One request, no redirects. DNS answers are vetted inside the socket lookup, so a rebinding name cannot slip a private address in. */
export function requestOnce(raw: string, policy: NetPolicy, options: RequestOptions): Promise<HopResponse | { failure: FetchFailure }> {
  const verdict = checkUrl(raw, policy);
  if (verdict !== "ok") return Promise.resolve({ failure: verdict === "offsite" ? "blocked_address" : verdict });
  const url = new URL(raw);
  const started = Date.now();
  return new Promise((resolve) => {
    let settled = false;
    const done = (value: HopResponse | { failure: FetchFailure }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    let blocked = false;
    const lookup = (hostname: string, opts: { all?: boolean; family?: number }, callback: (err: Error | null, address?: string | LookupAddress[], family?: number) => void) => {
      dnsLookup(hostname, { all: true, family: opts.family ?? 0 }, (err, addresses) => {
        if (err) return callback(err);
        // Every address the name resolves to must be public, not just the first.
        if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address, policy))) {
          blocked = true;
          return callback(new Error("address not allowed"));
        }
        if (opts.all) callback(null, addresses);
        else callback(null, addresses[0]!.address, addresses[0]!.family);
      });
    };
    const lib = url.protocol === "https:" ? https : http;
    const request = lib.request(
      url,
      {
        method: "GET",
        lookup: lookup as never,
        // No cookies, no authorization, no referrer: the crawler sees what an anonymous visitor sees.
        headers: { "user-agent": CRAWLER_USER_AGENT, accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5", "accept-encoding": "gzip, br" },
      },
      (response: IncomingMessage) => {
        const headers: Record<string, string> = {};
        for (const [key, value] of Object.entries(response.headers)) if (value !== undefined) headers[key] = Array.isArray(value) ? value.join(", ") : value;
        const status = response.statusCode ?? 0;
        const finish = (body: Buffer | null, truncated: boolean) => {
          response.destroy();
          done({ status, headers, body, truncated, ms: Date.now() - started });
        };
        if (!options.wantBody(headers["content-type"] ?? "", status)) return finish(null, false);
        const encoding = (headers["content-encoding"] ?? "").toLowerCase();
        const stream = encoding === "gzip" || encoding === "x-gzip" ? response.pipe(zlib.createGunzip()) : encoding === "br" ? response.pipe(zlib.createBrotliDecompress()) : encoding === "deflate" ? response.pipe(zlib.createInflate()) : response;
        const chunks: Buffer[] = [];
        let size = 0;
        stream.on("data", (chunk: Buffer) => {
          // The cap applies to decompressed bytes, so a small compressed bomb cannot expand past it.
          const room = options.maxBytes - size;
          if (chunk.length >= room) {
            chunks.push(chunk.subarray(0, room));
            finish(Buffer.concat(chunks), true);
            stream.destroy();
            return;
          }
          chunks.push(chunk);
          size += chunk.length;
        });
        stream.on("end", () => finish(Buffer.concat(chunks), false));
        stream.on("error", () => finish(chunks.length ? Buffer.concat(chunks) : null, true));
      },
    );
    const timer = setTimeout(() => {
      request.destroy();
      done({ failure: "timeout" });
    }, options.timeoutMs);
    request.on("error", () => done({ failure: blocked ? "blocked_address" : "network" }));
    request.end();
  });
}

export type FetchResult = {
  /** URLs visited in order; the last one produced `response`. */
  chain: { url: string; status: number }[];
  response: (HopResponse & { url: string }) | null;
  failure: FetchFailure | "redirect_loop" | "too_many_redirects" | null;
  /** A redirect pointed outside the site. It is recorded and not followed. */
  offsiteTarget: string | null;
  ms: number;
};

/** Follows redirects by hand so every hop goes through the same checks as the first request. */
export async function fetchFollow(start: string, policy: NetPolicy, options: RequestOptions & { maxRedirects: number }): Promise<FetchResult> {
  const chain: { url: string; status: number }[] = [];
  const seen = new Set<string>();
  let current = start;
  let ms = 0;
  for (;;) {
    if (seen.has(current)) return { chain, response: null, failure: "redirect_loop", offsiteTarget: null, ms };
    seen.add(current);
    const hop = await requestOnce(current, policy, options);
    if ("failure" in hop) return { chain, response: null, failure: hop.failure, offsiteTarget: null, ms };
    ms += hop.ms;
    const location = hop.headers.location;
    if (hop.status >= 300 && hop.status < 400 && location) {
      chain.push({ url: current, status: hop.status });
      let next: string;
      try {
        const target = new URL(location, current);
        target.hash = "";
        next = target.toString();
      } catch {
        return { chain, response: { ...hop, url: current }, failure: null, offsiteTarget: null, ms };
      }
      const verdict = checkUrl(next, policy);
      if (verdict === "offsite") return { chain, response: null, failure: null, offsiteTarget: next, ms };
      if (verdict !== "ok") return { chain, response: null, failure: verdict, offsiteTarget: null, ms };
      if (chain.length > options.maxRedirects) return { chain, response: null, failure: "too_many_redirects", offsiteTarget: null, ms };
      current = next;
      continue;
    }
    return { chain, response: { ...hop, url: current }, failure: null, offsiteTarget: null, ms };
  }
}
