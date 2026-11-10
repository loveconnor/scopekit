# ScopeKit

Private, owner-operated analytics and SEO workspace for the sites you run. This repository
implements phases 0 to 4 of the product spec: the foundation, first-party web analytics,
Google Search Console, the site audit crawler, performance monitoring, alerts and
annotations. Tracked keywords (phase 5) are not built, and that screen says so instead of
showing placeholder numbers.

## Layout

```
apps/web         Next.js dashboard and authenticated JSON API
apps/collector   Public event ingestion (Hono) and the hosted tracker at /script.js
apps/worker      BullMQ consumers: event inserts, rollups, retention, site purges,
                 Search Console sync, site crawls, Lighthouse runs, alert checks
packages/contracts   Zod schemas and shared types (event payload, API inputs)
packages/analytics   Pure logic: URL and property sanitizing, source classification,
                     timezone-aware ranges, day aggregation, metric definitions
packages/db          Drizzle schema, migrations and queries
packages/seo         Search Console: OAuth, token encryption, the Google client, the sync
                     engine and the opportunity rules
packages/audit       Site crawler (address checks, robots.txt, HTML and sitemap parsing),
                     the 28 audit rules, and the score
packages/health      PageSpeed Insights and Chrome UX Report clients, and the alert rules
packages/sdk         Browser tracker (about 2 KB gzip) and a Next.js helper
tests/               End-to-end checks for tracking, Search Console sync, the crawler, and
                     performance and alerts; a stand-in Google server; a fixture website
```

Events flow browser → collector → Redis queue → worker → Postgres. The collector derives
every trusted field (device, source, visitor estimate) and never passes an IP address or
user agent downstream. Rollups are rebuilt per site-local day from raw events, so retries
and reruns cannot double count.

## Run it locally

Needs Node 22+, Postgres and Redis.

```sh
cp .env.example .env        # set DATABASE_URL, REDIS_URL, SCOPEKIT_ALLOWED_EMAILS, BETTER_AUTH_SECRET
npm install
npm run db:migrate
npm run dev                 # web on :3000, collector on :8787, worker
```

Sign in at http://localhost:3000 with an allowlisted email. Without `RESEND_API_KEY` the
one-time sign-in link is printed in the web server log. Setting `GITHUB_CLIENT_ID` and
`GITHUB_CLIENT_SECRET` adds GitHub sign-in. There are no passwords and no public signup.

To try the tracker against a local site, add its host and port (for example
`localhost:4000`) as an alias under Site settings → Domains.

### Search Console

Optional. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `SCOPEKIT_ENCRYPTION_KEY` (see
`.env.example`) for both the app and the worker, then connect a property under Site settings
→ Search Console. Only the read-only scope is requested, and tokens are envelope-encrypted
before they are stored.

- The worker syncs each property daily. It asks Google which day is final, fetches the last
  seven final days again, and replaces whole days, so reruns never double count.
- Property totals are requested on their own. Query and page rows are detail and are never
  summed into a total, because Google leaves anonymized queries out of them.
- History is backfilled in the background, up to about 16 months, with a checkpoint per week.
- A rate limit pauses the sync and retries on its own. A revoked grant keeps the stored
  history and asks for a reconnect.
- Dashboard pages read stored rows only. The two things that call Google at request time are
  the property picker and a URL inspection you start yourself.

### Site audit

Start a crawl from Site audit. The worker visits up to the site's page limit, starting from
the homepage and its sitemaps, and checks the pages against 28 rules.

- It requests only the site's confirmed hostnames, always follows robots.txt, sends no
  cookies, and refuses private, loopback and cloud-metadata addresses on every request and
  redirect, including when a hostname resolves to one.
- A crawl that stops early is labeled partial and gets no score. Issues on pages it did not
  reach stay open: only a crawl that could have seen an issue can resolve it.
- Issues can be ignored or snoozed, a rule can be switched off or given another severity
  per site, and one page can be rechecked. Each crawl adds an observation; evidence is never
  rewritten.
- It reads static HTML. Content rendered by JavaScript is not seen.

### Performance and alerts

Set `GOOGLE_API_KEY` for lab runs (Lighthouse through PageSpeed Insights) and field data
(Chrome UX Report). The two are shown apart: a lab run is one synthetic load, field data is
what real Chrome users experienced, and small sites often have none.

Alerts are checked hourly and raised once per event: tracking stopped, search clicks down
over finalized weeks, a new critical audit issue, a Lighthouse regression on two runs in a
row, field vitals moving into a worse band, and lost Search Console access. Each can be
switched off per site. Email is optional (`RESEND_API_KEY`).

### Demo data

```sh
npm run demo:seed           # three synthetic sites on .example hostnames, two with search data
npm run demo:clear
```

Demo sites only appear when `SCOPEKIT_DEMO=1`, are labeled as demo data everywhere, and are
never accepted by the collector.

## Checks

```sh
npm test                    # unit tests: sanitizing, sources, DST day bounds, aggregation,
                            # token encryption, weighted position, opportunity rules
npm run test:gsc            # Search Console sync against a stand-in Google server; needs Postgres
npm run test:audit          # crawler against a fixture site with known problems; needs Postgres
npm run test:health         # lab runs, field data and alerts against a stand-in provider
npm run typecheck
npm run lint
npm run size:tracker        # fails if the tracker exceeds 5 KB gzip
CHROME_PATH=/path/to/chromium npm run test:e2e   # real-browser tracking check; needs collector + worker running
```

## Deploying

The three apps deploy independently. The dashboard can go to Vercel; the collector and the
worker need a long-running Node host (`npm run build` then `npm start` in each app) with
access to the same Postgres and Redis. Behind a CDN or proxy, set
`COLLECTOR_TRUSTED_PROXIES` and, for country data, `COLLECTOR_COUNTRY_HEADER`.

## What the numbers mean

Definitions live in `packages/analytics/src/metrics.ts` and are shown in the app under
Settings and on every metric label. The short version:

- Visitors are an estimate of unique devices per site per day, summed over a range. They
  are never deduplicated across days or across sites.
- 7, 30 and 90 day ranges cover complete days in the site's timezone. Today and 24h are the
  explicit in-progress views, and the unfinished period is drawn as in progress.
- Search figures come from Search Console, use Pacific Time days, end on the newest day
  Google has finalized, and are never mixed with ScopeKit pageviews. CTR is total clicks over
  total impressions; average position is weighted by impressions and is not a live rank.
- Opportunity priority orders work from 0 to 100. It is not a traffic estimate.
- The audit score is this product's own summary of open issues from a complete crawl. It is
  not a Google rating. Lighthouse scores are shown as the provider returned them.
- A missing data source reads "Not connected". It is never shown as zero.
