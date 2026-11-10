import { sql, type SQL } from "drizzle-orm";
import type { Database } from "./client";

/** Runs a raw query and returns plain rows. */
export async function rows<T>(db: Pick<Database, "execute">, query: SQL): Promise<T[]> {
  const result = await db.execute(query);
  return Array.from(result as unknown as Iterable<T>);
}

/** Raw queries take timestamps as ISO strings; the driver does not serialize Date params here. */
export const ts = (value: Date) => sql`${value.toISOString()}::timestamptz`;

/** Timestamp column as an ISO-8601 UTC string. */
export const iso = (column: SQL) =>
  sql`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
