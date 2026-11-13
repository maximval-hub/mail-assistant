import express from "express";
import helmet from "helmet";
import type { MailBackend } from "./mail";
import { parseSender, senderHeader, setupMcp, type Settings } from "./mcp";
import type { Sender } from "./mail";

/** Default sender (MAIL_FROM or MAIL_USER) first, then each MAIL_ALLOWED_FROM entry ("addr" or "Name <addr>", comma-separated). */
export function sendersFromEnv(env: NodeJS.ProcessEnv): Sender[] {
  const def = parseSender(env.MAIL_FROM || env.MAIL_USER || "");
  if (!def) throw Error("MAIL_FROM or MAIL_USER must be an email address or Name <address>");
  const senders: Sender[] = [def];
  for (const raw of (env.MAIL_ALLOWED_FROM || "").split(",").map(x => x.trim()).filter(Boolean)) {
    const s = parseSender(raw);
    if (!s) throw Error("MAIL_ALLOWED_FROM: each entry must be an email address or Name <address>");
    if (!senders.some(x => x.address.toLowerCase() === s.address.toLowerCase())) senders.push(s);
  }
  if (senders.length > 20) throw Error("MAIL_ALLOWED_FROM: at most 20 senders");
  return senders;
}

export function settingsFromEnv(env: NodeJS.ProcessEnv): Settings {
  const limit = Number(env.MAIL_DAILY_SEND_LIMIT || 50);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw Error("MAIL_DAILY_SEND_LIMIT must be an integer 1-500");
  const senders = sendersFromEnv(env);
  return { sendingEnabled: env.MAIL_SENDING_ENABLED === "true", dailySendLimit: limit, account: senderHeader(senders[0]), senders };
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
