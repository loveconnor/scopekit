import "server-only";
import { cookies } from "next/headers";
import { VIEW_COOKIE, withSavedView, type SearchParams } from "./params";

/** The page's URL parameters with the saved range and comparison filled in where the URL has none. */
export async function viewParams(params: SearchParams): Promise<SearchParams> {
  const saved = (await cookies()).get(VIEW_COOKIE)?.value;
  return withSavedView(params, saved ? decodeURIComponent(saved) : undefined);
}
