import "server-only";
import { getDb, schema } from "@scopekit/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins";
import { env } from "./env";

export const isAllowedEmail = (email: string) => env.allowedEmails.includes(email.trim().toLowerCase());

/** Sends the sign-in link by email, or prints it to the server log when no mail provider is configured. */
async function deliverSignInLink(email: string, url: string) {
  if (!env.resendKey || !env.emailFrom) {
    console.log(`\n[scopekit] Sign-in link for ${email} (valid 10 minutes):\n${url}\n`);
    return;
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.emailFrom,
      to: email,
      subject: "Your ScopeKit sign-in link",
      text: `Open this link to sign in to ScopeKit. It works once and expires in 10 minutes.\n\n${url}`,
    }),
  });
  if (!response.ok) console.error(`[scopekit] Sign-in email failed with status ${response.status}`);
}

export const auth = betterAuth({
  baseURL: env.appUrl,
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(getDb(), { provider: "pg", schema, usePlural: true }),
  // No passwords and no default admin account: sign-in is a one-time link or OAuth.
  emailAndPassword: { enabled: false },
  socialProviders: env.github ? { github: env.github } : {},
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
  advanced: {
    cookiePrefix: "scopekit",
    defaultCookieAttributes: { sameSite: "lax", httpOnly: true },
  },
  databaseHooks: {
    user: {
      create: {
        // The allowlist is the only door, whichever sign-in method is used.
        before: async (user) => {
          if (!isAllowedEmail(user.email)) throw new APIError("FORBIDDEN", { message: "This account is not allowed" });
          return { data: user };
        },
      },
    },
    session: {
      create: {
        before: async (session) => {
          const db = getDb();
          const user = await db.query.users.findFirst({ where: (u, { eq }) => eq(u.id, session.userId) });
          if (!user || !isAllowedEmail(user.email)) throw new APIError("FORBIDDEN", { message: "This account is not allowed" });
          return { data: session };
        },
      },
    },
  },
  plugins: [
    magicLink({
      expiresIn: 600,
      sendMagicLink: async ({ email, url }) => {
        // Unknown addresses get the same response and no email, so the allowlist cannot be probed.
        if (!isAllowedEmail(email)) return;
        await deliverSignInLink(email, url);
      },
    }),
    nextCookies(),
  ],
});
