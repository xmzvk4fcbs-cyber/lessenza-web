import type { EmailMessage } from "./mailer";
import type { Booking } from "./calendar-domain";
import { formatSalon } from "./time";
import { formatPhoneNational } from "./phone";

export interface ClientTemplateCtx {
  salonAddress: string;
  ownerPhone?: string;
}

export interface OwnerTemplateCtx {
  ownerEmail: string;
  siteUrl: string;
}

function formatDateHuman(iso: string): string {
  // "ponedjeljak, 20.04.2026. u 10:00"
  return formatSalon(new Date(iso), "EEEE, dd.MM.yyyy. 'u' HH:mm");
}

export function bookingConfirmedToClient(b: Booking, ctx: ClientTemplateCtx): EmailMessage {
  if (!b.email) throw new Error("Booking has no client email");
  const dateLine = formatDateHuman(b.startISO);
  const phoneLine = ctx.ownerPhone ? `Za izmjene pozovite ${formatPhoneNational(ctx.ownerPhone)}.` : "";
  const text = [
    `Zdravo ${b.name},`,
    ``,
    `Potvrda termina u L'Essenza Beauty Salon:`,
    ``,
    `Usluga: ${b.serviceName}`,
    `Kada: ${dateLine}`,
    `Gdje: ${ctx.salonAddress}`,
    ``,
    phoneLine,
    ``,
    `Vidimo se uskoro!`,
    `— L'Essenza`,
  ].filter(Boolean).join("\n");

  return {
    to: b.email,
    subject: "L'Essenza — Potvrda termina",
    text,
  };
}

export function bookingCreatedToOwner(b: Booking, ctx: OwnerTemplateCtx): EmailMessage {
  const dateLine = formatDateHuman(b.startISO);
  const text = [
    `Novi termin:`,
    ``,
    `Usluga: ${b.serviceName}`,
    `Kada: ${dateLine}`,
    `Klijent: ${b.name}`,
    `Telefon: ${b.phoneE164}`,
    `Email: ${b.email ?? "—"}`,
    `Napomena: ${b.note ?? "—"}`,
    ``,
    `Otvori u adminu: ${ctx.siteUrl.replace(/\/$/, "")}/admin/`,
  ].join("\n");

  return {
    to: ctx.ownerEmail,
    subject: `Novi termin — ${b.serviceName} (${formatSalon(new Date(b.startISO), "dd.MM. HH:mm")})`,
    text,
  };
}

export interface InquiryForEmail {
  id: string;
  createdAt: string;
  name: string;
  phone: string;
  email?: string;
  serviceId: string;
  serviceName: string;
  desiredDateISO: string;
  desiredTimeWindow: string;
  note?: string;
  status: string;
}

export function inquiryCreatedToOwner(i: InquiryForEmail, ctx: OwnerTemplateCtx): EmailMessage {
  const text = [
    `Novi upit za termin van prozora rezervacije:`,
    ``,
    `Usluga: ${i.serviceName}`,
    `Željeni datum: ${i.desiredDateISO} (${i.desiredTimeWindow})`,
    `Klijent: ${i.name}`,
    `Telefon: ${i.phone}`,
    `Email: ${i.email ?? "—"}`,
    `Napomena: ${i.note ?? "—"}`,
    ``,
    `Otvori u adminu: ${ctx.siteUrl.replace(/\/$/, "")}/admin/`,
  ].join("\n");

  return {
    to: ctx.ownerEmail,
    subject: `Novi upit — ${i.serviceName} (${i.desiredDateISO})`,
    text,
  };
}

export function bookingCancelledToClient(
  b: Booking,
  reason: string,
  ctx: ClientTemplateCtx
): EmailMessage {
  if (!b.email) throw new Error("Booking has no client email");
  const dateLine = formatDateHuman(b.startISO);
  const phoneLine = ctx.ownerPhone ? `Za novi termin pozovite ${formatPhoneNational(ctx.ownerPhone)}.` : "";
  const text = [
    `Zdravo ${b.name},`,
    ``,
    `Nažalost moramo otkazati vaš termin:`,
    ``,
    `Usluga: ${b.serviceName}`,
    `Kada: ${dateLine}`,
    reason ? `Razlog: ${reason}` : "",
    ``,
    phoneLine,
    ``,
    `— L'Essenza`,
  ].filter(Boolean).join("\n");
  return { to: b.email, subject: "L'Essenza — Termin je otkazan", text };
}

export function bookingRescheduledToClient(
  original: Booking,
  updated: Booking,
  ctx: ClientTemplateCtx
): EmailMessage {
  if (!updated.email) throw new Error("Booking has no client email");
  const oldLine = formatDateHuman(original.startISO);
  const newLine = formatDateHuman(updated.startISO);
  const phoneLine = ctx.ownerPhone ? `Za izmjene pozovite ${formatPhoneNational(ctx.ownerPhone)}.` : "";
  const text = [
    `Zdravo ${updated.name},`,
    ``,
    `Vaš termin u L'Essenza je pomjeren.`,
    ``,
    `Usluga: ${updated.serviceName}`,
    `Stari termin: ${oldLine}`,
    `Novi termin: ${newLine}`,
    `Gdje: ${ctx.salonAddress}`,
    ``,
    phoneLine,
    ``,
    `— L'Essenza`,
  ].filter(Boolean).join("\n");
  return { to: updated.email, subject: "L'Essenza — Termin pomjeren", text };
}

export function inquiryAcceptedToClient(
  i: InquiryForEmail,
  startISO: string,
  ctx: ClientTemplateCtx
): EmailMessage {
  if (!i.email) throw new Error("Inquiry has no client email");
  const dateLine = formatDateHuman(startISO);
  const phoneLine = ctx.ownerPhone ? `Za izmjene pozovite ${formatPhoneNational(ctx.ownerPhone)}.` : "";
  const text = [
    `Zdravo ${i.name},`,
    ``,
    `Vaš upit je prihvaćen. Zakazan termin:`,
    ``,
    `Usluga: ${i.serviceName}`,
    `Kada: ${dateLine}`,
    `Gdje: ${ctx.salonAddress}`,
    ``,
    phoneLine,
    ``,
    `— L'Essenza`,
  ].filter(Boolean).join("\n");
  return { to: i.email, subject: "L'Essenza — Upit prihvaćen", text };
}

export function inquiryDeclinedToClient(
  i: InquiryForEmail,
  reason: string,
  ctx: ClientTemplateCtx
): EmailMessage {
  if (!i.email) throw new Error("Inquiry has no client email");
  const phoneLine = ctx.ownerPhone ? `Za drugi datum pozovite ${formatPhoneNational(ctx.ownerPhone)}.` : "";
  const text = [
    `Zdravo ${i.name},`,
    ``,
    `Nažalost za ${i.desiredDateISO} nemamo slobodan termin.`,
    reason ? `Napomena: ${reason}` : "",
    ``,
    phoneLine,
    ``,
    `— L'Essenza`,
  ].filter(Boolean).join("\n");
  return { to: i.email, subject: "L'Essenza — Upit", text };
}
