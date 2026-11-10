import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth, isAllowedEmail } from "./auth";

export type CurrentUser = { id: string; email: string; name: string };

/** Session lookup, deduplicated within one request. Returns null when signed out. */
export const getOptionalUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !isAllowedEmail(session.user.email)) return null;
  return { id: session.user.id, email: session.user.email, name: session.user.name };
});

/** For pages and layouts: every data read starts here, so nothing renders for a signed-out request. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getOptionalUser();
  if (!user) redirect("/login");
  return user;
}
