import { Parser } from "htmlparser2";

export type PageFacts = {
  /** Every <title> in the document, in order. More than one is itself a finding. */
  titles: string[];
  metaDescriptions: string[];
  robotsMeta: string | null;
  /** Canonical hrefs resolved to absolute URLs. Unparsable ones are kept as written. */
  canonicals: string[];
  h1s: string[];
  hasViewport: boolean;
  links: { href: string; nofollow: boolean }[];
  imagesMissingAlt: { count: number; samples: string[] };
  jsonLdErrors: string[];
  hreflang: { lang: string; href: string }[];
  /** http:// subresources referenced from the document. */
  insecureResources: string[];
  wordCount: number;
  lang: string | null;
};

const SKIP_TEXT = new Set(["script", "style", "noscript", "template", "svg", "head", "title"]);
const clean = (text: string) => text.replace(/\s+/g, " ").trim();

function resolve(href: string, base: string): string | null {
  try {
    return new URL(href.trim(), base).toString();
  } catch {
    return null;
  }
}

/** Pulls the facts the audit rules need out of static HTML. Nothing is executed. */
export function extractPage(html: string, pageUrl: string): PageFacts {
  const facts: PageFacts = {
    titles: [],
    metaDescriptions: [],
    robotsMeta: null,
    canonicals: [],
    h1s: [],
    hasViewport: false,
    links: [],
    imagesMissingAlt: { count: 0, samples: [] },
    jsonLdErrors: [],
    hreflang: [],
    insecureResources: [],
    wordCount: 0,
    lang: null,
  };
  let base = pageUrl;
  let capture: { kind: "title" | "h1" | "jsonld"; text: string } | null = null;
  let skipDepth = 0;
  const stack: string[] = [];
  let titleInSvg = false;
  const insecure = (value: string | undefined) => {
    if (value && /^http:\/\//i.test(value.trim()) && facts.insecureResources.length < 20) facts.insecureResources.push(value.trim());
  };

  const parser = new Parser(
    {
      onopentag(name, a) {
        stack.push(name);
        if (SKIP_TEXT.has(name)) skipDepth++;
        if (name === "html" && a.lang) facts.lang = a.lang;
        else if (name === "base" && a.href) base = resolve(a.href, pageUrl) ?? base;
        else if (name === "title") {
          titleInSvg = stack.includes("svg");
          if (!titleInSvg) capture = { kind: "title", text: "" };
        } else if (name === "h1") capture = { kind: "h1", text: "" };
        else if (name === "meta") {
          const key = (a.name ?? "").toLowerCase();
          if (key === "description") facts.metaDescriptions.push(clean(a.content ?? ""));
          else if (key === "robots" || key === "googlebot") facts.robotsMeta = [facts.robotsMeta, (a.content ?? "").toLowerCase()].filter(Boolean).join(", ");
          else if (key === "viewport") facts.hasViewport = true;
        } else if (name === "link") {
          const rel = (a.rel ?? "").toLowerCase().split(/\s+/);
          if (rel.includes("canonical") && a.href !== undefined) facts.canonicals.push(resolve(a.href, base) ?? a.href);
          if (rel.includes("alternate") && a.hreflang !== undefined) facts.hreflang.push({ lang: a.hreflang, href: a.href ?? "" });
          if (rel.includes("stylesheet")) insecure(a.href);
        } else if (name === "a" && a.href !== undefined) {
          const href = a.href.trim();
          if (href && !/^(#|mailto:|tel:|javascript:|data:)/i.test(href)) {
            const absolute = resolve(href, base);
            if (absolute) facts.links.push({ href: absolute, nofollow: /\bnofollow\b/i.test(a.rel ?? "") });
          }
        } else if (name === "img") {
          insecure(a.src);
          // An empty alt marks a decorative image and is fine; a missing attribute is not.
          if (a.alt === undefined && a.role !== "presentation" && a["aria-hidden"] !== "true") {
            facts.imagesMissingAlt.count++;
            if (facts.imagesMissingAlt.samples.length < 5) facts.imagesMissingAlt.samples.push((a.src ?? "(no src)").slice(0, 300));
          }
        } else if (name === "script") {
          insecure(a.src);
          if ((a.type ?? "").toLowerCase() === "application/ld+json") capture = { kind: "jsonld", text: "" };
        } else if (name === "iframe" || name === "video" || name === "audio" || name === "source") insecure(a.src);
      },
      ontext(text) {
        if (capture) capture.text += text;
        if (skipDepth === 0) {
          const words = text.trim().split(/\s+/).filter(Boolean).length;
          facts.wordCount += words;
        }
      },
      onclosetag(name) {
        const index = stack.lastIndexOf(name);
        if (index > -1) stack.length = index;
        if (SKIP_TEXT.has(name) && skipDepth > 0) skipDepth--;
        if (!capture) return;
        if (name === "title" && capture.kind === "title") facts.titles.push(clean(capture.text));
        else if (name === "h1" && capture.kind === "h1") facts.h1s.push(clean(capture.text).slice(0, 300));
        else if (name === "script" && capture.kind === "jsonld") {
          try {
            JSON.parse(capture.text);
          } catch (error) {
            if (facts.jsonLdErrors.length < 5) facts.jsonLdErrors.push((error as Error).message.slice(0, 160));
          }
        } else return;
        capture = null;
      },
    },
    { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true },
  );
  parser.write(html);
  parser.end();
  return facts;
}

export type SitemapDocument = { type: "urlset" | "index" | "invalid"; locs: string[] };

/** Reads a sitemap or sitemap index. Anything else is reported as invalid, not guessed at. */
export function parseSitemap(xml: string, limit = 50_000): SitemapDocument {
  let type: SitemapDocument["type"] = "invalid";
  const locs: string[] = [];
  const stack: string[] = [];
  let text = "";
  const parser = new Parser(
    {
      onopentag(name) {
        const local = name.replace(/^.*:/, "");
        if (stack.length === 0 && local === "urlset") type = "urlset";
        if (stack.length === 0 && local === "sitemapindex") type = "index";
        stack.push(local);
        text = "";
      },
      ontext(chunk) {
        text += chunk;
      },
      onclosetag() {
        const local = stack.pop();
        const parent = stack[stack.length - 1];
        if (local === "loc" && (parent === "url" || parent === "sitemap") && locs.length < limit) {
          const value = text.trim();
          if (value) locs.push(value);
        }
        text = "";
      },
    },
    { xmlMode: true, decodeEntities: true },
  );
  parser.write(xml);
  parser.end();
  return { type, locs };
}
