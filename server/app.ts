import express from "express";
import helmet from "helmet";
import type { MailBackend } from "./mail";
import { setupMcp, type Settings } from "./mcp";

export function settingsFromEnv(env: NodeJS.ProcessEnv): Settings {
  const limit = Number(env.MAIL_DAILY_SEND_LIMIT || 50);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw Error("MAIL_DAILY_SEND_LIMIT must be an integer 1-500");
  return { sendingEnabled: env.MAIL_SENDING_ENABLED === "true", dailySendLimit: limit, account: env.MAIL_FROM || env.MAIL_USER || "" };
}

export function createApp(env: NodeJS.ProcessEnv, backend: MailBackend) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(express.json({ limit: "64kb" }));
  // Health check touches nothing external: a mail-provider outage must not restart the service.
  app.get("/healthz", (_req, res) => res.json({ ok: true }));
  const ctx = setupMcp(app, env, backend, settingsFromEnv(env));
  app.use((_req, res) => res.status(404).json({ error: "NOT_FOUND" }));
  return { app, ctx };
}
