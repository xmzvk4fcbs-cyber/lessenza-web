import { randomUUID } from "node:crypto";
import type { Handler } from "@netlify/functions";
import { json, badRequest, methodNotAllowed, parseJson } from "../lib/http";
import { addCancelRequest, getSettings, getPushSubscriptions, removePushSubscription } from "../lib/config";
import { getMailerAsync } from "../lib/mailer";
import { cancelRequestToOwner } from "../lib/email-templates";
import { normalizePhone } from "../lib/phone";
import { isHoneypotTriggered } from "../lib/honeypot";
import { rateLimitAllow, clientIP } from "../lib/rate-limit";
import type { CancelRequest } from "../lib/schemas";

/**
 * Client without an email link asks for cancellation. We DO NOT auto-cancel —
 * just store the request and notify the owner, who confirms manually in admin.
 * Phone alone isn't an authenticator (anyone could look it up), so the owner
 * is the gate.
 */
interface Req {
  phone: string;
  name: string;
  desiredDateISO: string;
  kind?: "cancel" | "reschedule";
  reason?: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowed(["POST"]);

  let body: Req;
  try {
    body = parseJson<Req>(event.body);
  } catch {
    return badRequest("invalid-json", "Body must be JSON");
  }

  if (isHoneypotTriggered(body as unknown as Record<string, unknown>)) {
    return json({ ok: true }, 200); // silently succeed for bots
  }

  const ip = clientIP(event.headers as Record<string, string | undefined>);
  const rl = await rateLimitAllow(ip, { key: "cancel-request", limit: 5, windowSeconds: 3600 });
  if (!rl.allowed) {
    return json(
      { error: "rate-limited", message: "Previše zahtjeva, probajte ponovo kasnije." },
      429,
      { "retry-after": String(rl.retryAfterSec) }
    );
  }

  if (!body.phone || !body.name || !body.desiredDateISO) {
    return badRequest("missing-fields", "phone, name, desiredDateISO required");
  }
  if (!DATE_RE.test(body.desiredDateISO)) {
    return badRequest("bad-date", "desiredDateISO must be YYYY-MM-DD");
  }

  const settings = await getSettings();
  const phone = normalizePhone(body.phone, settings.defaultCountryCode);
  if (!phone) return badRequest("bad-phone", "Phone number is invalid");

  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
  const kind = body.kind === "reschedule" ? "reschedule" : "cancel";

  const req: CancelRequest = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    phone,
    name: body.name.trim().slice(0, 120),
    desiredDateISO: body.desiredDateISO,
    kind,
    reason: reason || undefined,
    status: "pending",
  };
  await addCancelRequest(req);

  // Email the owner — best-effort (so they're notified even with push off).
  if (settings.ownerEmail) {
    try {
      const mailer = await getMailerAsync();
      await mailer.send(cancelRequestToOwner(
        { name: req.name, phone: req.phone, desiredDateISO: req.desiredDateISO, kind, reason: req.reason },
        { ownerEmail: settings.ownerEmail, siteUrl: process.env.SITE_URL ?? "https://lessenza.me" }
      ));
    } catch (e) {
      console.warn("[cancel-request][email] failed:", (e as Error).message);
    }
  }

  // Push to owner — best-effort.
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    try {
      const webpush = (await import("web-push")).default;
      webpush.setVapidDetails(
        process.env.VAPID_SUBJECT || "mailto:info@lessenza.me",
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY,
      );
      const subs = await getPushSubscriptions();
      const title = kind === "reschedule" ? "Zahtjev za pomjeranje" : "Zahtjev za otkazivanje";
      const payload = JSON.stringify({
        title,
        body: `${req.name} (${req.phone}) za ${req.desiredDateISO}${reason ? ` — ${reason}` : ""}`,
        url: "/admin/?screen=inquiries#cancel-requests",
      });
      for (const s of subs) {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload);
        } catch (e: unknown) {
          const err = e as { statusCode?: number };
          if (err.statusCode === 404 || err.statusCode === 410) {
            await removePushSubscription(s.endpoint);
          }
        }
      }
    } catch (e) {
      console.warn("[cancel-request][push] failed:", (e as Error).message);
    }
  }

  return json({ ok: true, id: req.id });
};
