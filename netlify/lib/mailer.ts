import { randomUUID } from "node:crypto";

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

// Factory — real adapters wired in Plan 2/4
export function getMailer(): Mailer {
  if (process.env.NODE_ENV === "test") return createLogMailer();
  // Plan 2 replaces this with Resend or Gmail adapter based on settings.mailer
  return createLogMailer();
}
