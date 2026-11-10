import { apiError, readJson, withUser } from "@/lib/api";
import { env } from "@/lib/env";
import { normalizeOrigin } from "@scopekit/analytics";
import { createSiteSchema } from "@scopekit/contracts";
import { createSite, HostnameTakenError, listSites, writeAuditLog } from "@scopekit/db";

export async function GET(request: Request) {
  return withUser(request, async ({ db }) => Response.json({ sites: await listSites(db, { includeDemo: env.demo }) }));
}

export async function POST(request: Request) {
  return withUser(request, async ({ db, user, requestId }) => {
    const input = await readJson(request, createSiteSchema);
    let target: { origin: string; hostname: string };
    try {
      target = normalizeOrigin(input.url);
    } catch (error) {
      return apiError(422, "invalid_url", (error as Error).message, [{ path: "url", message: (error as Error).message }], requestId);
    }
    try {
      const site = await createSite(db, { name: input.name, timezone: input.timezone, privacyMode: input.privacyMode, ...target });
      await writeAuditLog(db, {
        actorId: user.id,
        siteId: site.id,
        entity: "site",
        action: "created",
        summary: `Added ${input.name} (${target.hostname})`,
      });
      return Response.json({ id: site.id, publicTrackingId: site.publicTrackingId, origin: target.origin }, { status: 201 });
    } catch (error) {
      if (error instanceof HostnameTakenError) {
        return apiError(409, "hostname_taken", error.message, [{ path: "url", message: error.message }], requestId);
      }
      throw error;
    }
  });
}
