import { createApp } from "./app";
import { ImapSmtpBackend, parseSenderNames, parseUnipileAccounts } from "./mail";

const env = process.env;
const missing = ["MAIL_USER", "MAIL_PASS", "MCP_API_TOKEN"].filter(k => !env[k]);
if (missing.length) {
  console.error(`Startup refused: set ${missing.join(", ")}.`);
  process.exit(1);
}
const port = (name: string, fallback: number) => {
  const n = Number(env[name] || fallback);
  if (!Number.isInteger(n) || n < 1 || n > 65535) { console.error(`Startup refused: ${name} is not a valid port.`); process.exit(1); }
  return n;
};
const backend = new ImapSmtpBackend({
  user: env.MAIL_USER!, pass: env.MAIL_PASS!, from: env.MAIL_FROM || env.MAIL_USER!,
  imapHost: env.IMAP_HOST || "mail.runbox.com", imapPort: port("IMAP_PORT", 993),
  smtpHost: env.SMTP_HOST || "mail.runbox.com", smtpPort: port("SMTP_PORT", 465),
  senderNames: parseSenderNames(env.MAIL_SENDER_NAMES),
  ...(env.UNIPILE_DSN && env.UNIPILE_API_KEY && env.UNIPILE_ACCOUNTS
    ? { unipile: { dsn: env.UNIPILE_DSN, apiKey: env.UNIPILE_API_KEY, accounts: parseUnipileAccounts(env.UNIPILE_ACCOUNTS) } } : {}),
});
try {
  const { app } = createApp(env, backend);
  app.listen(port("PORT", 10000), "0.0.0.0", () => console.log("Mail assistant ready"));
} catch (e) {
  console.error("Startup refused:", e instanceof Error ? e.message : "invalid configuration");
  process.exit(1);
}
