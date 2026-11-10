import { DEFAULT_EXCLUDED_PATHS, stripWww } from "@scopekit/analytics";
import type { PrivacyMode, UpdateSiteInput } from "@scopekit/contracts";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import type { Database } from "../client";
import { goals, siteCredentials, siteDomains, sites, siteSettings } from "../schema";
import { markDirtyRetainedDays } from "./rollups";

export type SiteSummary = typeof sites.$inferSelect & {
  primaryHostname: string;
  publicTrackingId: string | null;
};
export type SiteDetail = SiteSummary & {
  hostnames: string[];
  settings: typeof siteSettings.$inferSelect;
};

export class HostnameTakenError extends Error {
  constructor(public hostname: string) {
    super(`${hostname} is already assigned to a website`);
  }
}

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
export function generatePublicTrackingId(): string {
  let id = "";
  for (const byte of randomBytes(16)) id += BASE62[byte % 62];
  return `sk_site_${id}`;
}

const visible = (includeDemo: boolean) =>
  includeDemo ? isNull(sites.deletedAt) : and(isNull(sites.deletedAt), eq(sites.isDemo, false));

export async function listSites(db: Database, opts: { includeDemo: boolean }): Promise<SiteSummary[]> {
  const result = await db
    .select({
      site: sites,
      primaryHostname: sql<string>`coalesce((select hostname from ${siteDomains} d where d.site_id = "sites"."id" order by d.is_primary desc, d.created_at limit 1), '')`,
      publicTrackingId: sql<string | null>`(select public_tracking_id from ${siteCredentials} c where c.site_id = "sites"."id" and c.revoked_at is null order by c.created_at desc limit 1)`,
    })
    .from(sites)
    .where(visible(opts.includeDemo))
    .orderBy(asc(sites.createdAt));
  return result.map((r) => ({ ...r.site, primaryHostname: r.primaryHostname, publicTrackingId: r.publicTrackingId }));
}

export async function getSite(db: Database, siteId: string, opts: { includeDemo: boolean }): Promise<SiteDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(siteId)) return null;
  const [site] = await db.select().from(sites).where(and(eq(sites.id, siteId), visible(opts.includeDemo)));
  if (!site) return null;
  const [domains, [settings], [credential]] = await Promise.all([
    db.select().from(siteDomains).where(eq(siteDomains.siteId, siteId)).orderBy(sql`is_primary desc, created_at`),
    db.select().from(siteSettings).where(eq(siteSettings.siteId, siteId)),
    db
      .select()
      .from(siteCredentials)
      .where(and(eq(siteCredentials.siteId, siteId), isNull(siteCredentials.revokedAt)))
      .orderBy(sql`created_at desc`)
      .limit(1),
  ]);
  if (!settings) return null;
  return {
    ...site,
    primaryHostname: domains[0]?.hostname ?? "",
    publicTrackingId: credential?.publicTrackingId ?? null,
    hostnames: domains.map((d) => d.hostname),
    settings,
  };
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 4; depth++) {
    if ((current as { code?: string }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export async function createSite(
  db: Database,
  input: { name: string; origin: string; hostname: string; timezone: string; privacyMode: PrivacyMode; isDemo?: boolean },
): Promise<{ id: string; publicTrackingId: string }> {
  // The www and bare forms are the same property; both are accepted by the collector.
  const bare = stripWww(input.hostname);
  const alias = input.hostname === bare ? `www.${bare}` : bare;
  const hostnames = input.hostname === "localhost" || input.hostname.startsWith("localhost:") ? [input.hostname] : [input.hostname, alias];
  const publicTrackingId = generatePublicTrackingId();
  try {
    return await db.transaction(async (tx) => {
      const [site] = await tx
        .insert(sites)
        .values({
          name: input.name,
          canonicalOrigin: input.origin,
          timezone: input.timezone,
          privacyMode: input.privacyMode,
          isDemo: input.isDemo ?? false,
        })
        .returning({ id: sites.id });
      const siteId = site!.id;
      await tx.insert(siteDomains).values(
        hostnames.map((hostname, index) => ({
          siteId,
          hostname,
          isPrimary: index === 0,
          verifiedAt: new Date(),
          verificationMethod: "owner_confirmation" as const,
        })),
      );
      await tx.insert(siteSettings).values({ siteId, excludedPathPatterns: DEFAULT_EXCLUDED_PATHS });
      await tx.insert(siteCredentials).values({ siteId, publicTrackingId });
      return { id: siteId, publicTrackingId };
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new HostnameTakenError(input.hostname);
    throw error;
  }
}

export async function updateSite(db: Database, site: SiteDetail, patch: UpdateSiteInput): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      const siteFields: Partial<typeof sites.$inferInsert> = {};
      if (patch.name !== undefined) siteFields.name = patch.name;
      if (patch.timezone !== undefined) siteFields.timezone = patch.timezone;
      if (patch.privacyMode !== undefined) siteFields.privacyMode = patch.privacyMode;
      if (Object.keys(siteFields).length) await tx.update(sites).set(siteFields).where(eq(sites.id, site.id));

      const settingFields: Partial<typeof siteSettings.$inferInsert> = {};
      if (patch.trackingEnabled !== undefined) settingFields.trackingEnabled = patch.trackingEnabled;
      if (patch.geolocationEnabled !== undefined) settingFields.geolocationEnabled = patch.geolocationEnabled;
      if (patch.retentionDays !== undefined) settingFields.retentionDays = patch.retentionDays;
      if (patch.allowedQueryParams !== undefined) settingFields.allowedQueryParams = [...new Set(patch.allowedQueryParams)];
      if (patch.excludedPathPatterns !== undefined) settingFields.excludedPathPatterns = [...new Set(patch.excludedPathPatterns)];
      if (Object.keys(settingFields).length) {
        await tx
          .update(siteSettings)
          .set({ ...settingFields, version: sql`${siteSettings.version} + 1`, updatedAt: new Date() })
          .where(eq(siteSettings.siteId, site.id));
      }

      if (patch.aliases !== undefined) {
        const wanted = new Set(patch.aliases.filter((h) => h !== site.primaryHostname));
        await tx.delete(siteDomains).where(and(eq(siteDomains.siteId, site.id), eq(siteDomains.isPrimary, false)));
        if (wanted.size) {
          await tx.insert(siteDomains).values(
            [...wanted].map((hostname) => ({
              siteId: site.id,
              hostname,
              isPrimary: false,
              verifiedAt: new Date(),
              verificationMethod: "owner_confirmation" as const,
            })),
          );
        }
      }

      // Local-day boundaries move with the timezone, so retained days are rebuilt.
      if (patch.timezone !== undefined && patch.timezone !== site.timezone) await markDirtyRetainedDays(tx, site.id);
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new HostnameTakenError("One of these hostnames");
    throw error;
  }
}

/**
 * Stops collection immediately (hostnames and tracking ID are released) and hides the site.
 * The worker's maintenance job then purges events, rollups and goals for good.
 */
export async function softDeleteSite(db: Database, siteId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(sites).set({ deletedAt: new Date(), status: "disabled" }).where(eq(sites.id, siteId));
    await tx.delete(siteDomains).where(eq(siteDomains.siteId, siteId));
    await tx.update(siteCredentials).set({ revokedAt: new Date() }).where(eq(siteCredentials.siteId, siteId));
  });
}

export async function listGoals(db: Database, siteId: string) {
  return db.select().from(goals).where(eq(goals.siteId, siteId)).orderBy(asc(goals.createdAt));
}
