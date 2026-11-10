// Mail backend: IMAP for reading and drafts, SMTP for sending. One short-lived connection per call.
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import { simpleParser } from "mailparser";
import { randomUUID } from "node:crypto";

export type MailConfig = {
  user: string; pass: string; from: string;
  imapHost: string; imapPort: number; smtpHost: string; smtpPort: number;
};
export type Summary = {
  uid: number; folder: string; from: string; to: string; subject: string;
  date: string | null; seen: boolean; messageId: string | null;
};
export type SearchQuery = {
  folder: string; text?: string; from?: string; to?: string; subject?: string;
  since?: string; before?: string; unseen?: boolean; limit: number;
};
export type MessageBody = Summary & {
  cc: string; inReplyTo: string | null; references: string[]; text: string; truncated: boolean;
  attachments: { filename: string | null; contentType: string; size: number }[];
};
export type Outgoing = { to: string[]; cc: string[]; subject: string; text: string; inReplyTo?: string };
export type Folder = { path: string; specialUse: string | null; messages: number | null; unseen: number | null };

export interface MailBackend {
  folders(): Promise<Folder[]>;
  search(q: SearchQuery): Promise<{ total: number; messages: Summary[] }>;
  read(folder: string, uid: number, maxChars: number): Promise<MessageBody | null>;
  saveDraft(m: Outgoing): Promise<{ folder: string; uid: number | null }>;
  send(m: Outgoing): Promise<{ messageId: string; accepted: string[]; rejected: string[]; savedToSent: boolean }>;
}

const addr = (a: any): string =>
  (a?.value ?? a ?? []).map((x: any) => (x.name ? `${x.name} <${x.address}>` : x.address)).filter(Boolean).join(", ");
const envAddr = (list: any[] | undefined) =>
  (list ?? []).map(x => (x.name ? `${x.name} <${x.address}>` : x.address)).filter(Boolean).join(", ");

function htmlToText(html: string) {
  return html.replace(/<(style|script)[\s\S]*?<\/\1>/gi, "").replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\n{3,}/g, "\n\n").trim();
}

export class ImapSmtpBackend implements MailBackend {
  constructor(private cfg: MailConfig) {}

  private async withImap<T>(fn: (c: ImapFlow) => Promise<T>): Promise<T> {
    const c = new ImapFlow({
      host: this.cfg.imapHost, port: this.cfg.imapPort, secure: true,
      auth: { user: this.cfg.user, pass: this.cfg.pass }, logger: false,
      socketTimeout: 30_000, greetingTimeout: 15_000, connectionTimeout: 15_000,
    });
    c.on("error", () => {});
    await c.connect();
    try { return await fn(c); } finally { try { await c.logout(); } catch { /* connection already gone */ } }
  }

  async folders(): Promise<Folder[]> {
    return this.withImap(async c => {
      const list = await c.list({ statusQuery: { messages: true, unseen: true } });
      return list.filter(f => !f.flags?.has("\\Noselect")).map(f => ({
        path: f.path, specialUse: f.specialUse ?? null,
        messages: f.status?.messages ?? null, unseen: f.status?.unseen ?? null,
      }));
    });
  }

  async search(q: SearchQuery) {
    return this.withImap(async c => {
      const lock = await c.getMailboxLock(q.folder, { readOnly: true });
      try {
        const query: any = {};
        if (q.text) query.text = q.text;
        if (q.from) query.from = q.from;
        if (q.to) query.to = q.to;
        if (q.subject) query.subject = q.subject;
        if (q.since) query.since = new Date(q.since);
        if (q.before) query.before = new Date(q.before);
        if (q.unseen) query.seen = false;
        const found = await c.search(Object.keys(query).length ? query : { all: true }, { uid: true });
        const uids = (found || []) as number[];
        const newest = uids.slice(-q.limit);
        const messages: Summary[] = [];
        if (newest.length) {
          for await (const m of c.fetch(newest, { uid: true, envelope: true, flags: true }, { uid: true })) {
            messages.push({
              uid: m.uid, folder: q.folder, from: envAddr(m.envelope?.from), to: envAddr(m.envelope?.to),
              subject: m.envelope?.subject ?? "", date: m.envelope?.date ? new Date(m.envelope.date).toISOString() : null,
              seen: m.flags?.has("\\Seen") ?? false, messageId: m.envelope?.messageId ?? null,
            });
          }
        }
        messages.sort((a, b) => b.uid - a.uid);
        return { total: uids.length, messages };
      } finally { lock.release(); }
    });
  }

  async read(folder: string, uid: number, maxChars: number): Promise<MessageBody | null> {
    return this.withImap(async c => {
      const lock = await c.getMailboxLock(folder, { readOnly: true }); // read-only: never sets \Seen
      try {
        const m = await c.fetchOne(String(uid), { uid: true, flags: true, source: true }, { uid: true });
        if (!m || !m.source) return null;
        const p = await simpleParser(m.source);
        const full = (p.text && p.text.trim()) || (typeof p.html === "string" ? htmlToText(p.html) : "");
        const refs = Array.isArray(p.references) ? p.references : p.references ? [p.references] : [];
        return {
          uid, folder, from: addr(p.from), to: addr(p.to), cc: addr(p.cc), subject: p.subject ?? "",
          date: p.date ? p.date.toISOString() : null, seen: m.flags?.has("\\Seen") ?? false,
          messageId: p.messageId ?? null, inReplyTo: p.inReplyTo ?? null, references: refs,
          text: full.slice(0, maxChars), truncated: full.length > maxChars,
          attachments: p.attachments.map(a => ({ filename: a.filename ?? null, contentType: a.contentType, size: a.size })),
        };
      } finally { lock.release(); }
    });
  }

  private mailOptions(m: Outgoing, messageId: string) {
    return {
      from: this.cfg.from, to: m.to, cc: m.cc.length ? m.cc : undefined, subject: m.subject, text: m.text,
      messageId, date: new Date(),
      ...(m.inReplyTo ? { inReplyTo: m.inReplyTo, references: m.inReplyTo } : {}),
    };
  }
  private raw(opts: any): Promise<Buffer> {
    return new Promise((resolve, reject) =>
      new MailComposer(opts).compile().build((e: Error | null, b: Buffer) => (e ? reject(e) : resolve(b))));
  }
  private newMessageId() {
    const domain = this.cfg.from.match(/@([^>\s]+)/)?.[1] ?? "localhost";
    return `<${randomUUID()}@${domain}>`;
  }
  private async folderBySpecialUse(c: ImapFlow, use: string, fallback: string[]) {
    const list = await c.list();
    return list.find(f => f.specialUse === use)?.path
      ?? list.find(f => fallback.includes(f.path.toLowerCase()))?.path ?? null;
  }

  async saveDraft(m: Outgoing) {
    const raw = await this.raw(this.mailOptions(m, this.newMessageId()));
    return this.withImap(async c => {
      const folder = await this.folderBySpecialUse(c, "\\Drafts", ["drafts", "draft"]);
      if (!folder) throw new Error("NO_DRAFTS_FOLDER");
      const r = await c.append(folder, raw, ["\\Draft", "\\Seen"]);
      return { folder, uid: r && typeof r === "object" && "uid" in r ? (r.uid as number) : null };
    });
  }

  async send(m: Outgoing) {
    const messageId = this.newMessageId();
    const opts = this.mailOptions(m, messageId);
    const transport = nodemailer.createTransport({
      host: this.cfg.smtpHost, port: this.cfg.smtpPort, secure: this.cfg.smtpPort === 465,
      auth: { user: this.cfg.user, pass: this.cfg.pass }, connectionTimeout: 15_000, socketTimeout: 30_000,
    });
    const info = await transport.sendMail(opts);
    // The message has left. Failing to file the Sent copy must never look like a failed send.
    let savedToSent = false;
    try {
      const raw = await this.raw(opts);
      await this.withImap(async c => {
        const folder = await this.folderBySpecialUse(c, "\\Sent", ["sent", "sent items", "sent messages"]);
        if (folder) { await c.append(folder, raw, ["\\Seen"]); savedToSent = true; }
      });
    } catch { /* keep savedToSent=false */ }
    return {
      messageId: info.messageId || messageId,
      accepted: (info.accepted as any[]).map(String), rejected: (info.rejected as any[]).map(String), savedToSent,
    };
  }
}
