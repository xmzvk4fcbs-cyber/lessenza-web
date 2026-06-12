import { parsePhoneNumberFromString } from "libphonenumber-js";
import type { CountryCode } from "libphonenumber-js";

const COUNTRY_BY_CODE: Record<string, CountryCode> = {
  "+382": "ME",
  "+381": "RS",
  "+385": "HR",
  "+387": "BA",
  "+386": "SI",
  "+389": "MK",
  "+355": "AL",
  "+49": "DE",
  "+43": "AT",
  "+39": "IT",
  "+33": "FR",
  "+44": "GB",
  "+1": "US",
};

export function normalizePhone(raw: string, defaultDial = "+382"): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.length < 5) return null;
  const country = COUNTRY_BY_CODE[defaultDial];
  const parsed = parsePhoneNumberFromString(trimmed, country);
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number;
}

export function formatPhoneNational(e164: string): string {
  const parsed = parsePhoneNumberFromString(e164);
  if (!parsed) return e164;
  return parsed.formatNational();
}

export function digitsOnly(s: string): string {
  return s.replace(/\D+/g, "");
}

export function waLink(e164: string, text: string): string {
  const digits = digitsOnly(e164);
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export function viberAddLink(e164: string): string {
  // Unlike WhatsApp's wa.me, Viber has NO public link that opens a chat with an
  // arbitrary number — `chat?number=PHONE` works ONLY when the number is already
  // a Viber contact and fails silently on iOS otherwise. `add?number=PHONE`
  // opens Viber's add-contact screen prefilled with the number: one tap to add,
  // then the owner can message — the only way to reach a non-contact. The
  // message can't ride along on this scheme, so the client copies it to the
  // clipboard on click for a manual paste.
  const digits = e164.startsWith("+") ? e164 : `+${digitsOnly(e164)}`;
  return `viber://add?number=${encodeURIComponent(digits)}`;
}
