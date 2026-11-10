import "server-only";
import type { ApiError } from "@scopekit/contracts";
import { getDb, getSite, type Database, type SiteDetail } from "@scopekit/db";
import { unstable_rethrow } from "next/navigation";
import type { z } from "zod";
import { env } from "./env";
import { getOptionalUser, type CurrentUser } from "./session";

export function apiError(status: number, code: string, message: string, details?: unknown, requestId: string = crypto.randomUUID()) {
  const body: ApiError = { code, message, requestId, ...(details === undefined ? {} : { details }) };
  return Response.json(body, { status, headers: { "x-request-id": requestId } });
}

export type ApiContext = { user: CurrentUser; db: Database; requestId: string };

class ApiFailure extends Error {
  constructor(public response: Response) {
    super("api failure");
  }
}

/** Throws a ready-made error response from inside a handler. */
export function fail(status: number, code: string, message: string, details?: unknown): never {
  throw new ApiFailure(apiError(status, code, message, details));
}

const MUTATIONS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

/**
 * Every dashboard API route goes through here: session check, same-origin check for
 * mutations (CSRF), a request ID, and one stable error shape.
 */
export async function withUser(request: Request, handler: (ctx: ApiContext) => Promise<Response>): Promise<Response> {
  const requestId = crypto.randomUUID();
  try {
    const user = await getOptionalUser();
    if (!user) return apiError(401, "unauthorized", "Sign in to use the ScopeKit API", undefined, requestId);
    if (MUTATIONS.has(request.method)) {
      const origin = request.headers.get("origin");
      const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
      if (!origin || new URL(origin).host !== host) {
        return apiError(403, "bad_origin", "Cross-origin requests are not allowed", undefined, requestId);
      }
    }
    const response = await handler({ user, db: getDb(), requestId });
    response.headers.set("x-request-id", requestId);
    return response;
  } catch (error) {
    if (error instanceof ApiFailure) return error.response;
    // Framework control flow (redirects, prerender bail-outs) is not an application error.
    unstable_rethrow(error);
    console.error(JSON.stringify({ level: "error", msg: "api error", requestId, error: (error as Error).message }));
    return apiError(500, "internal_error", "Something went wrong on the server", undefined, requestId);
  }
}

/** Redirect whose headers can still be written to (a `Response.redirect` cannot take the request ID). */
export function redirectTo(location: string): Response {
  return new Response(null, { status: 302, headers: { location, "cache-control": "no-store" } });
}

/** Site-scoped routes: the site is loaded and authorized on every request. */
export async function withSite(
  request: Request,
  params: Promise<{ siteId: string }>,
  handler: (ctx: ApiContext & { site: SiteDetail }) => Promise<Response>,
): Promise<Response> {
  return withUser(request, async (ctx) => {
    const { siteId } = await params;
    const site = await getSite(ctx.db, siteId, { includeDemo: env.demo });
    if (!site) fail(404, "site_not_found", "No website with that ID");
    return handler({ ...ctx, site });
  });
}

export async function readJson<T extends z.ZodType>(request: Request, schema: T): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    fail(400, "invalid_json", "The request body is not valid JSON");
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    fail(
      422,
      "validation_failed",
      result.error.issues[0]?.message ?? "Invalid input",
      result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    );
  }
  return result.data;
}

/** CSV cell that cannot be interpreted as a formula by a spreadsheet. */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvResponse(filename: string, header: string[], rows: (string | number | null | undefined)[][]) {
  const lines = [header, ...rows].map((row) => row.map(csvCell).join(","));
  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
      "Cache-Control": "no-store",
    },
  });
}

export function searchParamsOf(request: Request): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of new URL(request.url).searchParams) {
    const existing = out[key];
    out[key] = existing === undefined ? value : Array.isArray(existing) ? [...existing, value] : [existing, value];
  }
  return out;
}
