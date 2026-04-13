import { randomUUID } from "node:crypto";
import type { Handler } from "@netlify/functions";
import { json, badRequest, methodNotAllowed, parseJson, notFound } from "../lib/http";
import { addInquiry, getServices, getSettings } from "../lib/config";
import { normalizePhone } from "../lib/phone";
import { getMailer, type Mailer } from "../lib/mailer";
import { inquiryCreatedToOwner } from "../lib/email-templates";
import type { Inquiry } from "../lib/schemas";
import { isHoneypotTriggered } from "../lib/honeypot";
import { rateLimitAllow, clientIP } from "../lib/rate-limit";

let mailerFactory: (() => Mailer) | null = null;
export function __setMailerForTests(f: (() => Mailer) | null): void {
  mailerFactory = f;
}
function makeMailer(): Mailer {
  return mailerFactory ? mailerFactory() : getMailer();
}

interface InquiryRequest {
  serviceId: string;
  desiredDateISO: string;
  desiredTimeWindow: "morning" | "afternoon" | "any";
  name: string;
  phone: string;
  email?: string;
  note?: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowed(["POST"]);

  let body: InquiryRequest;
  try {
    body = parseJson<InquiryRequest>(event.body);
  } catch {
    return badRequest("invalid-json", "Body must be JSON");
  }

  if (isHoneypotTriggered(body)) {
    return json({ ok: true }, 200);
  }
  const ip = clientIP(event.headers as Record<string, string | undefined>);
  const rl = await rateLimitAllow(ip, { key: "inquiry", limit: 5, windowSeconds: 3600 });
  if (!rl.allowed) {
    return json(
      { error: "rate-limited", message: "Previše zahtjeva, probajte ponovo kasnije" },
      429,
      { "retry-after": String(rl.retryAfterSec) }
    );
  }

  if (!body.serviceId || !body.desiredDateISO || !body.desiredTimeWindow || !body.name || !body.phone) {
    return badRequest("missing-fields", "serviceId, desiredDateISO, desiredTimeWindow, name, phone required");
  }
  if (!DATE_RE.test(body.desiredDateISO)) return badRequest("bad-date", "desiredDateISO must be YYYY-MM-DD");
  if (!["morning", "afternoon", "any"].includes(body.desiredTimeWindow))
    return badRequest("bad-window", "desiredTimeWindow must be morning|afternoon|any");

  const settings = await getSettings();
  const phone = normalizePhone(body.phone, settings.defaultCountryCode);
  if (!phone) return badRequest("bad-phone", "Phone number is invalid");

  const services = await getServices();
  const service = services.find((s) => s.id === body.serviceId);
  if (!service) return notFound("Unknown service");

  const inquiry: Inquiry = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    name: body.name.trim().slice(0, 120),
    phone,
    email: body.email?.trim() || undefined,
    serviceId: service.id,
    desiredDateISO: body.desiredDateISO,
    desiredTimeWindow: body.desiredTimeWindow,
    note: body.note?.trim() || undefined,
    status: "pending",
  };
  await addInquiry(inquiry);

  if (settings.ownerEmail) {
    try {
      await makeMailer().send(
        inquiryCreatedToOwner(
          { ...inquiry, serviceName: service.name },
          { ownerEmail: settings.ownerEmail, siteUrl: process.env.SITE_URL ?? "" }
        )
      );
    } catch {
      // email failure does not fail the inquiry
    }
  }

  return json({ ok: true, inquiryId: inquiry.id });
};
