import type { Handler } from "@netlify/functions";
import { json, badRequest, notFound, methodNotAllowed, parseJson } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
import { getMailer, type Mailer } from "../lib/mailer";
import { getInquiry, getServices, getSettings, updateInquiryStatus } from "../lib/config";
import { inquiryDeclinedToClient } from "../lib/email-templates";
import { waLink } from "../lib/phone";

let mailerFactory: (() => Mailer) | null = null;
export function __setMailerForTests(f: (() => Mailer) | null): void {
  mailerFactory = f;
}
function makeMailer(): Mailer {
  return mailerFactory ? mailerFactory() : getMailer();
}

const inner: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowed(["POST"]);
  let body: { inquiryId?: unknown; reason?: unknown };
  try {
    body = parseJson(event.body);
  } catch {
    return badRequest("invalid-json", "Body must be JSON");
  }
  const inquiryId = typeof body.inquiryId === "string" ? body.inquiryId : "";
  const reason = typeof body.reason === "string" ? body.reason : "";
  if (!inquiryId) return badRequest("missing-inquiryId", "inquiryId required");

  const inquiry = await getInquiry(inquiryId);
  if (!inquiry) return notFound("Inquiry not found");
  const services = await getServices();
  const service = services.find((s) => s.id === inquiry.serviceId);
  const settings = await getSettings();

  await updateInquiryStatus(inquiryId, "declined");

  let emailSent = false;
  let whatsappLink: string | null = null;
  if (inquiry.email) {
    try {
      await makeMailer().send(
        inquiryDeclinedToClient(
          { ...inquiry, serviceName: service?.name ?? inquiry.serviceId },
          reason,
          { salonAddress: settings.salonAddress, ownerPhone: settings.ownerPhone }
        )
      );
      emailSent = true;
    } catch {
      emailSent = false;
    }
  }
  if (inquiry.phone) {
    const msg = `Zdravo ${inquiry.name}, za ${inquiry.desiredDateISO} nažalost nemamo termin. ${reason ? `Razlog: ${reason}. ` : ""}Javite se za drugi datum. — L'Essenza`;
    whatsappLink = waLink(inquiry.phone, msg);
  }
  return json({ ok: true, emailSent, whatsappLink });
};

export const handler = adminGuard(inner);
