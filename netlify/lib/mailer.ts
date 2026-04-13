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

export function getMailer(settings?: { mailer?: "resend" | "gmail" }): Mailer {
  if (process.env.NODE_ENV === "test") return createLogMailer();
  const which = settings?.mailer ?? (process.env.GMAIL_USER ? "gmail" : "resend");
  if (which === "gmail") {
    const user = process.env.GMAIL_USER ?? "";
    const pass = process.env.GMAIL_APP_PASSWORD ?? "";
    if (!user || !pass) return createLogMailer();
    return createGmailMailer({ user, pass });
  }
  const apiKey = process.env.RESEND_API_KEY ?? "";
  const from = process.env.RESEND_FROM ?? "L'Essenza <onboarding@resend.dev>";
  if (!apiKey) return createLogMailer();
  return createResendMailer({ apiKey, from });
}
