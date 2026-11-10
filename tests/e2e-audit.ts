/**
 * Site crawler against a fixture website with known problems, and the real database.
 *
 *   npm run test:audit
 */
import { checkUrl, requestOnce, runCrawl } from "@scopekit/audit";
import { claimQueuedCrawls, closeDb, createSite, getCrawlRun, getDb, queueCrawl, CrawlAlreadyActiveError, requestCrawlCancel, saveRuleSetting, schema, setIssueState } from "@scopekit/db";
import { eq } from "drizzle-orm";
import { startFixtureSite } from "./fixture-site";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "pass" : "FAIL"}  ${name}${ok || !detail ? "" : `  (${detail})`}`);
  if (!ok) failures++;
};

const db = getDb();
const fixture = await startFixtureSite();
await db.delete(schema.sites).where(eq(schema.sites.name, "Audit e2e"));
const { id: siteId } = await createSite(db, { name: "Audit e2e", origin: fixture.origin, hostname: fixture.host, timezone: "UTC", privacyMode: "default" });
const options = { allowLoopback: true, minIntervalMs: 0, timeoutMs: 3000 };
const crawl = async (maxPages = 500, kind: "full" | "recheck" = "full", targetUrl?: string) => {
  const id = await queueCrawl(db, { siteId, kind, targetUrl, trigger: "manual", maxPages });
  await claimQueuedCrawls(db);
  const result = await runCrawl(db, id, options);
  return { id, result, run: (await getCrawlRun(db, id))! };
};
const issues = async () => db.select().from(schema.auditIssues).where(eq(schema.auditIssues.siteId, siteId));
const u = (path: string) => `${fixture.origin}${path}`;

try {
  /* Address safety, before anything is crawled */
  const hosts = (...h: string[]) => ({ allowedHosts: new Set(h) });
  check("a private address is refused even when listed as a hostname", checkUrl("http://10.0.0.5/", hosts("10.0.0.5")) === "blocked_address");
  check("the cloud metadata address is refused", checkUrl("http://169.254.169.254/latest/", hosts("169.254.169.254")) === "blocked_address");
  check("credentials in a URL are refused", checkUrl("https://user:pw@example.com/", hosts("example.com")) === "credentials");
  check("file and other schemes are refused", checkUrl("file:///etc/passwd", hosts("")) === "bad_protocol");
  check("an unlisted port is refused", checkUrl("http://example.com:8080/", hosts("example.com")) === "bad_port");
  const rebind = await requestOnce("http://localhost/", hosts("localhost"), { timeoutMs: 2000, maxBytes: 1000, wantBody: () => false });
  check("a hostname that resolves to loopback is refused at connect time", "failure" in rebind && rebind.failure === "blocked_address", JSON.stringify(rebind));

  /* First crawl */
  const first = await crawl();
  let all = await issues();
  const has = (rule: string, path: string, state = "open") => all.some((i) => i.ruleId === rule && i.url === u(path) && i.state === state);
  check("first crawl finishes with complete coverage", first.run.status === "done" && first.run.coverageComplete, `${first.run.status} ${first.run.errorSummary ?? ""}`);
  check("known 404 link is found on the linking page and on the target", has("BROKEN_INTERNAL_LINK", "/broken-link-page") && has("HTTP_4XX", "/missing"));
  check("missing title is found", has("MISSING_TITLE", "/no-title"));
  check("duplicate titles are found on both pages", has("DUPLICATE_TITLE", "/dup-a") && has("DUPLICATE_TITLE", "/dup-b"));
  check("broken canonical is found", has("CANONICAL_BROKEN", "/canon-a"));
  check("declared sitemap that does not exist is found", has("SITEMAP_BROKEN", "/missing-sitemap.xml"));
  check("sitemap entries that cannot be indexed are found", has("SITEMAP_NONINDEXABLE", "/gone") && has("SITEMAP_NONINDEXABLE", "/noindex-page"));
  check("noindex on a sitemap page is raised to high", all.find((i) => i.ruleId === "NOINDEX" && i.url === u("/noindex-page"))?.severity === "high");
  check("server error, redirect chain and loop are found", has("HTTP_5XX", "/server-error") && has("REDIRECT_CHAIN", "/chain-1") && has("REDIRECT_LOOP", "/loop"));
  check("orphan sitemap page is found in a complete crawl", has("INTERNAL_ORPHAN", "/orphan"));
  check("missing alt and invalid JSON-LD are found", has("ALT_MISSING", "/images") && has("STRUCTURED_DATA_INVALID_JSON", "/images"));
  check("a healthy page has no issues", !all.some((i) => i.url === u("/about")), all.filter((i) => i.url === u("/about")).map((i) => i.ruleId).join(","));
  check("robots.txt is honored: the disallowed page is recorded but never requested", has("ROBOTS_BLOCKED", "/private/secret") && !fixture.state.hits.includes("/private/secret"));
  check("a redirect to the metadata address is not followed", !all.some((i) => i.url.includes("169.254")) && first.result.status === "done");
  check("no cookies are sent and the crawler identifies itself", fixture.state.cookies === 0 && [...fixture.state.userAgents].every((ua) => ua.startsWith("ScopeKitBot/")));
  check("a complete crawl gets a score and counts by severity", typeof first.run.summary?.score === "number" && (first.run.summary?.open.critical ?? 0) === 1, JSON.stringify(first.run.summary?.open));
  check("every issue of the first crawl counts as new", first.result.newIssues === all.length && first.result.resolvedIssues === 0);

  /* Owner decisions */
  const ignored = all.find((i) => i.ruleId === "ALT_MISSING")!;
  await setIssueState(db, siteId, ignored.id, { state: "ignored", reason: "decorative" });
  await saveRuleSetting(db, siteId, "DUPLICATE_TITLE", { enabled: false });

  /* Two fixes, then a partial crawl */
  fixture.state.fixed = true;
  const partial = await crawl(3);
  all = await issues();
  check("a crawl that hits its page limit is labeled partial and gets no score", partial.run.status === "partial" && !partial.run.coverageComplete && partial.run.summary?.score === null && partial.run.summary?.stopReason === "page_limit");
  check("a partial crawl does not resolve issues on pages it did not visit", has("MISSING_TITLE", "/no-title") && has("BROKEN_INTERNAL_LINK", "/broken-link-page") && has("CANONICAL_BROKEN", "/canon-a"));
  check("a partial crawl does not resolve site-wide findings", has("INTERNAL_ORPHAN", "/orphan") && has("SITEMAP_BROKEN", "/missing-sitemap.xml"));

  /* Full recrawl */
  const second = await crawl();
  all = await issues();
  const resolved = all.filter((i) => i.state === "resolved").map((i) => `${i.ruleId} ${i.url.replace(fixture.origin, "")}`).sort();
  check("the recrawl resolves exactly the fixed problems", JSON.stringify(resolved) === JSON.stringify(["BROKEN_INTERNAL_LINK /broken-link-page", "HTTP_4XX /missing", "MISSING_TITLE /no-title"]), resolved.join(" | "));
  check("the run records what it resolved and that nothing is new", second.result.resolvedIssues === 3 && second.result.newIssues === 0, JSON.stringify(second.result));
  check("an ignored issue stays ignored when it is seen again", has("ALT_MISSING", "/images", "ignored"));
  check("a rule switched off for the site is neither raised nor resolved", has("DUPLICATE_TITLE", "/dup-a"));
  check("unfixed problems are still open", has("CANONICAL_BROKEN", "/canon-a") && has("HTTP_5XX", "/server-error") && has("SITEMAP_BROKEN", "/missing-sitemap.xml"));
  const observations = await db.select().from(schema.auditIssueObservations).where(eq(schema.auditIssueObservations.issueId, all.find((i) => i.ruleId === "CANONICAL_BROKEN")!.id));
  check("each crawl adds an observation instead of rewriting evidence", observations.length === 2, String(observations.length));

  /* Regression */
  fixture.state.fixed = false;
  const third = await crawl();
  all = await issues();
  check("a resolved issue that comes back is open and counted as new", has("MISSING_TITLE", "/no-title") && third.result.newIssues === 3, JSON.stringify(third.result));

  /* Recheck one page */
  await setIssueState(db, siteId, ignored.id, { state: "open" });
  fixture.state.altFixed = true;
  const hitsBefore = fixture.state.hits.length;
  const recheck = await crawl(1, "recheck", u("/images"));
  all = await issues();
  check("rechecking a page resolves what was fixed on it and nothing else", has("ALT_MISSING", "/images", "resolved") && has("STRUCTURED_DATA_INVALID_JSON", "/images") && has("CANONICAL_BROKEN", "/canon-a"), `${recheck.run.status}`);
  check("a recheck requests only robots.txt and the page", fixture.state.hits.length - hitsBefore === 2, String(fixture.state.hits.length - hitsBefore));

  /* One crawl at a time, and cancelling */
  const queued = await queueCrawl(db, { siteId, kind: "full", trigger: "manual", maxPages: 500 });
  let refused = false;
  try {
    await queueCrawl(db, { siteId, kind: "full", trigger: "manual", maxPages: 500 });
  } catch (error) {
    refused = error instanceof CrawlAlreadyActiveError;
  }
  check("a second crawl cannot be queued while one is active", refused);
  await claimQueuedCrawls(db);
  const running = runCrawl(db, queued, { ...options, minIntervalMs: 40 });
  setTimeout(() => void requestCrawlCancel(db, siteId), 300);
  const cancelled = await running;
  const cancelledRun = (await getCrawlRun(db, queued))!;
  check("a cancelled crawl stops early and is labeled cancelled", cancelled.status === "cancelled" && cancelledRun.pagesCrawled < 40 && !cancelledRun.coverageComplete, `${cancelled.status} ${cancelledRun.pagesCrawled}`);
  all = await issues();
  check("a cancelled crawl resolves nothing it did not see", has("CANONICAL_BROKEN", "/canon-a") || has("CANONICAL_BROKEN", "/canon-a", "open"));
} finally {
  await db.delete(schema.sites).where(eq(schema.sites.id, siteId));
  await fixture.close();
  await closeDb();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nAll site audit checks passed");
process.exit(failures ? 1 : 0);
