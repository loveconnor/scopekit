import { desc, eq, sql } from "drizzle-orm";
import type { Database } from "../client";
import { auditLogs, jobRuns, userPreferences } from "../schema";

export async function startJobRun(db: Database, jobType: string, siteId: string | null = null): Promise<string> {
  const [row] = await db.insert(jobRuns).values({ jobType, siteId, status: "running" }).returning({ id: jobRuns.id });
  return row!.id;
}

export async function finishJobRun(
  db: Database,
  id: string,
  outcome: { status: "done" | "error"; errorCode?: string; cursor?: Record<string, unknown> },
): Promise<void> {
  await db
    .update(jobRuns)
    .set({
      status: outcome.status,
      errorCode: outcome.errorCode?.slice(0, 200),
      cursor: outcome.cursor,
      finishedAt: new Date(),
      durationMs: sql`(extract(epoch from now() - ${jobRuns.startedAt}) * 1000)::int`,
    })
    .where(eq(jobRuns.id, id));
}

export async function listJobRuns(db: Database, limit = 30) {
  return db.select().from(jobRuns).orderBy(desc(jobRuns.startedAt)).limit(limit);
}

export async function pruneJobRuns(db: Database): Promise<void> {
  await db.execute(sql`delete from job_runs where started_at < now() - interval '30 days'`);
}

export async function writeAuditLog(
  db: Database,
  entry: {
    actorId: string | null;
    siteId?: string | null;
    entity: string;
    action: string;
    summary: string;
    metadata?: Record<string, string | number | boolean | null>;
  },
): Promise<void> {
  await db.insert(auditLogs).values({ ...entry, siteId: entry.siteId ?? null });
}

export async function listAuditLogs(db: Database, opts: { limit?: number; siteId?: string } = {}) {
  const query = db.select().from(auditLogs);
  const filtered = opts.siteId ? query.where(eq(auditLogs.siteId, opts.siteId)) : query;
  return filtered.orderBy(desc(auditLogs.at)).limit(opts.limit ?? 50);
}

export async function getPreferences(db: Database, userId: string) {
  const [row] = await db.select().from(userPreferences).where(eq(userPreferences.userId, userId));
  return row ?? { userId, theme: "system" as const, defaultRange: "30d" as const, lastSiteId: null, updatedAt: new Date(0) };
}

export async function savePreferences(
  db: Database,
  userId: string,
  patch: Partial<Pick<typeof userPreferences.$inferInsert, "theme" | "defaultRange" | "lastSiteId">>,
): Promise<void> {
  await db
    .insert(userPreferences)
    .values({ userId, ...patch })
    .onConflictDoUpdate({ target: userPreferences.userId, set: { ...patch, updatedAt: new Date() } });
}
