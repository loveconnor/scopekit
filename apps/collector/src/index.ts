import { serve } from "@hono/node-server";
import app, { queue, redis } from "./app";

const PORT = Number(process.env.COLLECTOR_PORT ?? 8787);

const log = (msg: string, fields: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ level: "info", msg, service: "collector", time: new Date().toISOString(), ...fields }));

const server = serve({ fetch: app.fetch, port: PORT }, () => log("collector listening", { port: PORT }));

const shutdown = async () => {
  server.close();
  await queue?.close().catch(() => {});
  redis?.disconnect();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
