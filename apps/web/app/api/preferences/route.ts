import { readJson, withUser } from "@/lib/api";
import { savePreferences } from "@scopekit/db";
import { z } from "zod";

const preferencesSchema = z
  .object({
    theme: z.enum(["system", "light", "dark"]),
    defaultRange: z.enum(["7d", "30d", "90d"]),
    lastSiteId: z.uuid().nullable(),
  })
  .partial();

export async function PATCH(request: Request) {
  return withUser(request, async ({ db, user }) => {
    await savePreferences(db, user.id, await readJson(request, preferencesSchema));
    return Response.json({ ok: true });
  });
}
