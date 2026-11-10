import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = ReturnType<typeof createDb>["db"];

export function createDb(url = process.env.DATABASE_URL, options: { max?: number } = {}) {
  if (!url) throw new Error("DATABASE_URL is not set");
  const client = postgres(url, {
    max: options.max ?? 10,
    ssl: /localhost|127\.0\.0\.1/.test(url) ? false : "require",
    onnotice: () => {},
  });
  return { db: drizzle(client, { schema }), client };
}

// One pool per process, and one across hot reloads in development.
const globalRef = globalThis as unknown as { __scopekitDb?: ReturnType<typeof createDb> };

export function getDb(): Database {
  globalRef.__scopekitDb ??= createDb();
  return globalRef.__scopekitDb.db;
}

export async function closeDb(): Promise<void> {
  await globalRef.__scopekitDb?.client.end({ timeout: 5 });
  globalRef.__scopekitDb = undefined;
}
