// Vercel function: every path is rewritten here (see vercel.json) and handled by the bundled Hono app.
import app from "../dist/app.js";

const handle = (request) => app.fetch(request);
export const GET = handle;
export const HEAD = handle;
export const POST = handle;
export const OPTIONS = handle;
