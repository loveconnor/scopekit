import "server-only";

export const env = {
  demo: process.env.SCOPEKIT_DEMO === "1",
  allowedEmails: (process.env.SCOPEKIT_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
  collectorUrl: (process.env.NEXT_PUBLIC_COLLECTOR_URL ?? "").replace(/\/$/, ""),
  appUrl: (process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  github: process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
    ? { clientId: process.env.GITHUB_CLIENT_ID, clientSecret: process.env.GITHUB_CLIENT_SECRET }
    : null,
  secureCookies: (process.env.BETTER_AUTH_URL ?? "").startsWith("https://"),
  resendKey: process.env.RESEND_API_KEY || null,
  emailFrom: process.env.SCOPEKIT_EMAIL_FROM || null,
};
