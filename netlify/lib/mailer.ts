import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
}

export interface Mailer {
  send(msg: EmailMessage): Promise<string>;
}

export interface LogMailer extends Mailer {
  sent: EmailMessage[];
}

/** Wraps a real mailer so every send is recorded in the email log (success or
 *  failure), with the full message kept for manual resend from the admin. */
function wrapWithLog(inner: Mailer): Mailer {
  return {
    async send(msg) {
      try {
        const id = await inner.send(msg);
        try {
          const { appendEmailLog } = await import("./email-log");
          await appendEmailLog({ to: msg.to, subject: msg.subject, ok: true, msg });
        } catch { /* logging must never break sending */ }
        return id;
      } catch (e) {
        try {
          const { appendEmailLog } = await import("./email-log");
          await appendEmailLog({ to: msg.to, subject: msg.subject, ok: false, error: (e as Error).message, msg });
        } catch { /* ignore */ }
        throw e;
      }
    },
  };
}

export function createLogMailer(): LogMailer {
  const sent: EmailMessage[] = [];
  return {
    sent,
    async send(msg) {
      sent.push(msg);
      return randomUUID();
    },
  };
}

export function createResendMailer(opts: { apiKey: string; from: string }): Mailer {
  return {
    async send(msg) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${opts.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: opts.from,
          to: msg.to,
          subject: msg.subject,
          text: msg.text,
          html: msg.html,
          reply_to: msg.replyTo,
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`resend error ${res.status}: ${txt}`);
      }
      const data = (await res.json()) as { id?: string };
      return data.id ?? randomUUID();
    },
  };
}

export interface GmailMailerOpts {
  user: string;
  pass: string;
  transportFactory?: (opts: { user: string; pass: string }) => {
    sendMail(msg: {
      from: string;
      to: string;
      subject: string;
      text: string;
      html?: string;
      replyTo?: string;
    }): Promise<{ messageId: string }>;
  };
}

export function createGmailMailer(opts: GmailMailerOpts): Mailer {
  const transport = (opts.transportFactory ?? defaultGmailTransport)({
    user: opts.user,
    pass: opts.pass,
  });
  return {
    async send(msg) {
      const info = await transport.sendMail({
        from: opts.user,
        to: msg.to,
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
        replyTo: msg.replyTo,
      });
      return info.messageId;
    },
  };
}

function defaultGmailTransport(opts: { user: string; pass: string }): {
  sendMail(msg: {
    from: string;
    to: string;
    subject: string;
    text: string;
    html?: string;
    replyTo?: string;
  }): Promise<{ messageId: string }>;
} {
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: opts.user, pass: opts.pass },
  }) as unknown as {
    sendMail(msg: {
      from: string;
      to: string;
      subject: string;
      text: string;
      html?: string;
      replyTo?: string;
    }): Promise<{ messageId: string }>;
  };
}

export interface SmtpMailerOpts {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  transportFactory?: (opts: { host: string; port: number; secure: boolean; user: string; pass: string }) => {
    sendMail(msg: {
      from: string;
      to: string;
      subject: string;
      text: string;
      html?: string;
      replyTo?: string;
    }): Promise<{ messageId: string }>;
  };
}

export function createSmtpMailer(opts: SmtpMailerOpts): Mailer {
  const transport = (opts.transportFactory ?? defaultSmtpTransport)({
    host: opts.host,
    port: opts.port,
    secure: opts.secure,
    user: opts.user,
    pass: opts.pass,
  });
  return {
    async send(msg) {
      const info = await transport.sendMail({
        from: opts.from,
        to: msg.to,
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
        replyTo: msg.replyTo,
      });
      return info.messageId;
    },
  };
}

function defaultSmtpTransport(opts: { host: string; port: number; secure: boolean; user: string; pass: string }): {
  sendMail(msg: {
    from: string;
    to: string;
    subject: string;
    text: string;
    html?: string;
    replyTo?: string;
  }): Promise<{ messageId: string }>;
} {
  return nodemailer.createTransport({
    host: opts.host,
    port: opts.port,
    secure: opts.secure,
    auth: { user: opts.user, pass: opts.pass },
  }) as unknown as {
    sendMail(msg: {
      from: string;
      to: string;
      subject: string;
      text: string;
      html?: string;
      replyTo?: string;
    }): Promise<{ messageId: string }>;
  };
}

/**
 * Gmail sender via OAuth (uses the token the owner granted through the admin UI).
 * Requires `gmail.send` scope (included by default in google-auth.ts).
 */
export function createGmailOAuthMailer(opts: {
  getAuth: () => Promise<import("google-auth-library").OAuth2Client>;
  from: string;
}): Mailer {
  return {
    async send(msg) {
      const auth = await opts.getAuth();
      const { google } = await import("googleapis");
      const gmail = google.gmail({ version: "v1", auth });
      const boundary = "lessenza_" + randomUUID().slice(0, 8);
      const headers = [
        `From: ${opts.from}`,
        `To: ${msg.to}`,
        `Subject: =?UTF-8?B?${Buffer.from(msg.subject, "utf8").toString("base64")}?=`,
        "MIME-Version: 1.0",
      ];
      if (msg.replyTo) headers.push(`Reply-To: ${msg.replyTo}`);
      let body: string;
      if (msg.html) {
        headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
        body = [
          "",
          `--${boundary}`,
          'Content-Type: text/plain; charset="UTF-8"',
          "Content-Transfer-Encoding: 7bit",
          "",
          msg.text,
          `--${boundary}`,
          'Content-Type: text/html; charset="UTF-8"',
          "Content-Transfer-Encoding: 7bit",
          "",
          msg.html,
          `--${boundary}--`,
        ].join("\r\n");
      } else {
        headers.push('Content-Type: text/plain; charset="UTF-8"');
        body = "\r\n" + msg.text;
      }
      const raw = Buffer.from(headers.join("\r\n") + body, "utf8")
        .toString("base64")
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const res = await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
      return res.data.id ?? randomUUID();
    },
  };
}

export async function getMailerAsync(_settings?: { mailer?: "resend" | "gmail" | "smtp" }): Promise<Mailer> {
  if (process.env.NODE_ENV === "test") return createLogMailer();
  // Email ALWAYS goes via the site's own SMTP (e.g. info@lessenza.me). Ignore any
  // settings.mailer hint — if it's set to "resend" but RESEND_API_KEY is missing,
  // getMailer would silently fall through to a log mailer and EVERY email would
  // be lost (that's the bug that ate booking confirmations). Auto-detect by env.
  return getMailer();
}

export function getMailer(settings?: { mailer?: "resend" | "gmail" | "smtp" }): Mailer {
  if (process.env.NODE_ENV === "test") return createLogMailer();
  const explicit = settings?.mailer;
  // Auto-detect: SMTP_HOST > GMAIL_USER > RESEND_API_KEY > log.
  const which =
    explicit ??
    (process.env.SMTP_HOST
      ? "smtp"
      : process.env.GMAIL_USER
      ? "gmail"
      : "resend");
  if (which === "smtp") {
    const host = process.env.SMTP_HOST ?? "";
    const port = Number(process.env.SMTP_PORT ?? "465");
    const user = process.env.SMTP_USER ?? "";
    const pass = process.env.SMTP_PASS ?? "";
    const from = process.env.SMTP_FROM ?? `L'Essenza <${user || "info@lessenza.me"}>`;
    // secure=true for port 465 (implicit TLS); false for 587 (STARTTLS upgrade).
    const secure = process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465;
    if (!host || !user || !pass) return createLogMailer();
    return wrapWithLog(createSmtpMailer({ host, port, secure, user, pass, from }));
  }
  if (which === "gmail") {
    const user = process.env.GMAIL_USER ?? "";
    const pass = process.env.GMAIL_APP_PASSWORD ?? "";
    if (!user || !pass) return createLogMailer();
    return wrapWithLog(createGmailMailer({ user, pass }));
  }
  const apiKey = process.env.RESEND_API_KEY ?? "";
  const from = process.env.RESEND_FROM ?? "L'Essenza <info@lessenza.me>";
  if (!apiKey) return createLogMailer();
  return wrapWithLog(createResendMailer({ apiKey, from }));
}
