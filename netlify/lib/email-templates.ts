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
  return formatSalon(new Date(iso), "EEEE, dd.MM.yyyy. 'u' HH:mm");
}

// --- Brand palette (must match css/style.css) ---
const BRAND = {
  cream: "#F4ECDB",
  creamSoft: "#F9F2E5",
  champagne: "#E8D5B5",
  gold: "#C9A961",
  goldLight: "#E0C58A",
  sage: "#6B6F4F",
  sageSoft: "#8B8E6F",
};

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function renderShell(opts: { heading: string; preheader?: string; inner: string }): string {
  const pre = opts.preheader ? esc(opts.preheader) : "";
  return `<!DOCTYPE html>
<html lang="sr-Latn">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(opts.heading)}</title>
</head>
<body style="margin:0;padding:0;background:#FBF8F2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${BRAND.sage};">
<span style="display:none!important;opacity:0;color:transparent;max-height:0;max-width:0;visibility:hidden;overflow:hidden;">${pre}</span>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FBF8F2;">
<tr><td align="center" style="padding:32px 16px;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;background:#ffffff;border:1px solid ${BRAND.champagne};border-radius:12px;overflow:hidden;">
    <tr>
      <td style="background:${BRAND.creamSoft};padding:36px 32px 26px;text-align:center;border-bottom:1px solid ${BRAND.champagne};">
        <img src="https://lessenza.me/img/logo-wordmark.png" alt="L'Essenza Beauty Salon" width="220" style="display:inline-block;max-width:65%;height:auto;border:0;outline:none;text-decoration:none;">
        <div style="font-size:10px;letter-spacing:4px;color:${BRAND.sageSoft};text-transform:uppercase;margin-top:12px;">Beauty Salon &middot; Cetinje</div>
      </td>
    </tr>
    <tr>
      <td style="padding:40px 32px 8px;text-align:center;">
        <h1 style="font-family:'Playfair Display',Georgia,'Times New Roman',serif;font-size:24px;color:${BRAND.sage};margin:0;font-weight:400;line-height:1.3;">${esc(opts.heading)}</h1>
        <div style="width:40px;height:1px;background:${BRAND.gold};margin:18px auto 8px;"></div>
      </td>
    </tr>
    <tr>
      <td style="padding:8px 32px 36px;color:${BRAND.sage};font-size:15px;line-height:1.65;">
        ${opts.inner}
      </td>
    </tr>
    <tr>
      <td style="background:#FBF8F2;padding:22px 32px;text-align:center;border-top:1px solid ${BRAND.champagne};">
        <div style="font-size:12px;color:${BRAND.sageSoft};line-height:1.7;">
          L'Essenza Beauty Salon &middot; Bajova 22, Cetinje<br>
          <a href="https://lessenza.me" style="color:${BRAND.gold};text-decoration:none;">lessenza.me</a>
        </div>
      </td>
    </tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}

function detailsTable(rows: Array<[string, string]>): string {
  const cells = rows.map(([k, v]) => `
    <tr>
      <td style="padding:10px 0;color:${BRAND.sageSoft};font-size:11px;letter-spacing:1.5px;text-transform:uppercase;width:110px;vertical-align:top;">${esc(k)}</td>
      <td style="padding:10px 0;color:${BRAND.sage};font-size:15px;font-weight:500;">${esc(v)}</td>
    </tr>`).join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:16px 0 8px;background:${BRAND.creamSoft};border:1px solid ${BRAND.champagne};border-radius:6px;">
  <tr><td style="padding:16px 20px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${cells}</table></td></tr>
  </table>`;
}

function paragraph(text: string): string {
  return `<p style="margin:0 0 14px;color:${BRAND.sage};font-size:15px;line-height:1.65;">${esc(text)}</p>`;
}

function paragraphRaw(html: string): string {
  return `<p style="margin:0 0 14px;color:${BRAND.sage};font-size:15px;line-height:1.65;">${html}</p>`;
}

function btnLink(href: string, label: string): string {
  return `<p style="text-align:center;margin:24px 0 8px;">
    <a href="${esc(href)}" style="display:inline-block;padding:14px 32px;background:${BRAND.gold};color:#ffffff;text-decoration:none;font-size:12px;letter-spacing:2.5px;text-transform:uppercase;font-weight:600;border-radius:3px;">${esc(label)}</a>
  </p>`;
}

function softNote(text: string): string {
  return `<p style="margin:18px 0 0;padding:14px 18px;background:${BRAND.cream};border-left:3px solid ${BRAND.gold};color:${BRAND.sage};font-size:14px;line-height:1.6;">${esc(text)}</p>`;
}

function signOff(): string {
  return `<p style="margin:28px 0 0;color:${BRAND.sageSoft};font-family:'Playfair Display',Georgia,serif;font-size:16px;font-style:italic;text-align:center;">&mdash; L'Essenza</p>`;
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export function bookingConfirmedToClient(b: Booking, ctx: ClientTemplateCtx): EmailMessage {
  if (!b.email) throw new Error("Booking has no client email");
  const dateLine = formatDateHuman(b.startISO);
  const phone = ctx.ownerPhone ? formatPhoneNational(ctx.ownerPhone) : "";
  const text = [
    `Zdravo ${b.name},`,
    ``,
    `Potvrda termina u L'Essenza Beauty Salon:`,
    ``,
    `Usluga: ${b.serviceName}`,
    `Kada: ${dateLine}`,
    `Gdje: ${ctx.salonAddress}`,
    ``,
    phone ? `Za izmjene pozovite ${phone}.` : "",
    ``,
    `Vidimo se uskoro!`,
    `— L'Essenza`,
  ].filter(Boolean).join("\n");

  const inner = [
    paragraph(`Zdravo ${b.name},`),
    paragraph(`Hvala što ste odabrali L'Essenza. Vaš termin je potvrđen.`),
    detailsTable([
      ["Usluga", b.serviceName],
      ["Kada", dateLine],
      ["Gdje", ctx.salonAddress],
    ]),
    phone ? softNote(`Za izmjene ili otkazivanje termina pozovite ${phone}.`) : "",
    paragraph(`Radujemo se vašem dolasku.`),
    signOff(),
  ].filter(Boolean).join("\n");

  return {
    to: b.email,
    subject: "L'Essenza — Potvrda termina",
    text,
    html: renderShell({ heading: "Termin je potvrđen", preheader: `${b.serviceName} · ${dateLine}`, inner }),
  };
}

export function bookingCreatedToOwner(b: Booking, ctx: OwnerTemplateCtx): EmailMessage {
  const dateLine = formatDateHuman(b.startISO);
  const adminUrl = `${ctx.siteUrl.replace(/\/$/, "")}/admin/`;
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
    `Otvori u adminu: ${adminUrl}`,
  ].join("\n");

  const inner = [
    paragraph(`Klijentkinja je upravo rezervisala termin.`),
    detailsTable([
      ["Usluga", b.serviceName],
      ["Kada", dateLine],
      ["Klijent", b.name],
      ["Telefon", b.phoneE164],
      ["Email", b.email ?? "—"],
      ["Napomena", b.note ?? "—"],
    ]),
    btnLink(adminUrl, "Otvori u adminu"),
  ].join("\n");

  return {
    to: ctx.ownerEmail,
    subject: `Novi termin — ${b.serviceName} (${formatSalon(new Date(b.startISO), "dd.MM. HH:mm")})`,
    text,
    html: renderShell({ heading: "Novi termin", preheader: `${b.name} · ${dateLine}`, inner }),
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
  const adminUrl = `${ctx.siteUrl.replace(/\/$/, "")}/admin/`;
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
    `Otvori u adminu: ${adminUrl}`,
  ].join("\n");

  const inner = [
    paragraph(`Stigao je novi upit za termin van uobičajenog prozora rezervacije.`),
    detailsTable([
      ["Usluga", i.serviceName],
      ["Željeno", `${i.desiredDateISO} (${i.desiredTimeWindow})`],
      ["Klijent", i.name],
      ["Telefon", i.phone],
      ["Email", i.email ?? "—"],
      ["Napomena", i.note ?? "—"],
    ]),
    btnLink(adminUrl, "Otvori u adminu"),
  ].join("\n");

  return {
    to: ctx.ownerEmail,
    subject: `Novi upit — ${i.serviceName} (${i.desiredDateISO})`,
    text,
    html: renderShell({ heading: "Novi upit za termin", preheader: `${i.name} · ${i.desiredDateISO}`, inner }),
  };
}

export function bookingCancelledToClient(
  b: Booking,
  reason: string,
  ctx: ClientTemplateCtx
): EmailMessage {
  if (!b.email) throw new Error("Booking has no client email");
  const dateLine = formatDateHuman(b.startISO);
  const phone = ctx.ownerPhone ? formatPhoneNational(ctx.ownerPhone) : "";
  const text = [
    `Zdravo ${b.name},`,
    ``,
    `Nažalost moramo otkazati vaš termin:`,
    ``,
    `Usluga: ${b.serviceName}`,
    `Kada: ${dateLine}`,
    reason ? `Razlog: ${reason}` : "",
    ``,
    phone ? `Za novi termin pozovite ${phone}.` : "",
    ``,
    `— L'Essenza`,
  ].filter(Boolean).join("\n");

  const rows: Array<[string, string]> = [
    ["Usluga", b.serviceName],
    ["Kada", dateLine],
  ];
  if (reason) rows.push(["Razlog", reason]);

  const inner = [
    paragraph(`Draga ${b.name},`),
    paragraph(`Izvinjavamo se, ali moramo otkazati vaš termin.`),
    detailsTable(rows),
    phone ? softNote(`Pozovite ${phone} da dogovorimo novi termin koji Vam odgovara — biće nam drago da Vas ugostimo.`) : "",
    signOff(),
  ].filter(Boolean).join("\n");

  return {
    to: b.email,
    subject: "L'Essenza — Termin je otkazan",
    text,
    html: renderShell({ heading: "Termin je otkazan", preheader: `${b.serviceName} · ${dateLine}`, inner }),
  };
}

export function bookingRejectedToClient(b: Booking, ctx: ClientTemplateCtx): EmailMessage {
  if (!b.email) throw new Error("rejected email requires booking.email");
  const when = formatDateHuman(b.startISO);
  const ownerPhoneDisplay = ctx.ownerPhone ? formatPhoneNational(ctx.ownerPhone) : "";
  const phoneLine = ctx.ownerPhone
    ? `<p style="margin:0 0 12px;font-size:14px;line-height:1.7;color:${BRAND.sageSoft};">
         Za dodatne informacije: <a href="tel:${esc(ctx.ownerPhone)}" style="color:${BRAND.gold};text-decoration:none;">${esc(ownerPhoneDisplay)}</a>
       </p>`
    : "";
  const inner = `
    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;">Draga ${esc(b.name)},</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;">
      Hvala na interesovanju za <strong>L'Essenza</strong>.
    </p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;">
      Nažalost, u narednom periodu ne mogu prihvatiti Vaš termin za <strong>${esc(b.serviceName)}</strong> (${esc(when)}).
    </p>
    ${phoneLine}
    <p style="margin:24px 0 0;font-size:14px;color:${BRAND.sageSoft};">Srdačno ✿ L'Essenza</p>
  `;
  return {
    to: b.email,
    subject: `Termin — L'Essenza`,
    html: renderShell({ heading: "Obavještenje o terminu", preheader: "Nažalost termin nije moguć.", inner }),
    text:
      `Draga ${b.name},\n\n` +
      `Hvala na interesovanju za L'Essenza. Nažalost, u narednom periodu ne mogu prihvatiti Vaš termin za ${b.serviceName} (${when}).\n\n` +
      (ownerPhoneDisplay ? `Za dodatne informacije: ${ownerPhoneDisplay}\n\n` : "") +
      `Srdačno ✿ L'Essenza`,
  };
}

export function bookingRescheduledToClient(
  original: Booking,
  updated: Booking,
  ctx: ClientTemplateCtx
): EmailMessage {
  if (!updated.email) throw new Error("Booking has no client email");
  const oldLine = formatDateHuman(original.startISO);
  const newLine = formatDateHuman(updated.startISO);
  const phone = ctx.ownerPhone ? formatPhoneNational(ctx.ownerPhone) : "";
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
    phone ? `Za izmjene pozovite ${phone}.` : "",
    ``,
    `— L'Essenza`,
  ].filter(Boolean).join("\n");

  const inner = [
    paragraph(`Draga ${updated.name},`),
    paragraph(`Vaš termin je pomjeren. Novi detalji su ispod.`),
    detailsTable([
      ["Usluga", updated.serviceName],
      ["Stari termin", oldLine],
      ["Novi termin", newLine],
      ["Gdje", ctx.salonAddress],
    ]),
    phone ? softNote(`Ako Vam novi termin ne odgovara, pozovite ${phone} pa ćemo naći drugi.`) : "",
    signOff(),
  ].filter(Boolean).join("\n");

  return {
    to: updated.email,
    subject: "L'Essenza — Termin pomjeren",
    text,
    html: renderShell({ heading: "Termin je pomjeren", preheader: `Novi termin: ${newLine}`, inner }),
  };
}

export function inquiryAcceptedToClient(
  i: InquiryForEmail,
  startISO: string,
  ctx: ClientTemplateCtx
): EmailMessage {
  if (!i.email) throw new Error("Inquiry has no client email");
  const dateLine = formatDateHuman(startISO);
  const phone = ctx.ownerPhone ? formatPhoneNational(ctx.ownerPhone) : "";
  const text = [
    `Zdravo ${i.name},`,
    ``,
    `Vaš upit je prihvaćen. Zakazan termin:`,
    ``,
    `Usluga: ${i.serviceName}`,
    `Kada: ${dateLine}`,
    `Gdje: ${ctx.salonAddress}`,
    ``,
    phone ? `Za izmjene pozovite ${phone}.` : "",
    ``,
    `— L'Essenza`,
  ].filter(Boolean).join("\n");

  const inner = [
    paragraph(`Zdravo ${i.name},`),
    paragraph(`Vaš upit je prihvaćen — termin je zakazan.`),
    detailsTable([
      ["Usluga", i.serviceName],
      ["Kada", dateLine],
      ["Gdje", ctx.salonAddress],
    ]),
    phone ? softNote(`Za izmjene pozovite ${phone}.`) : "",
    signOff(),
  ].filter(Boolean).join("\n");

  return {
    to: i.email,
    subject: "L'Essenza — Upit prihvaćen",
    text,
    html: renderShell({ heading: "Upit je prihvaćen", preheader: `${i.serviceName} · ${dateLine}`, inner }),
  };
}

export function inquiryDeclinedToClient(
  i: InquiryForEmail,
  reason: string,
  ctx: ClientTemplateCtx
): EmailMessage {
  if (!i.email) throw new Error("Inquiry has no client email");
  const phone = ctx.ownerPhone ? formatPhoneNational(ctx.ownerPhone) : "";
  const text = [
    `Zdravo ${i.name},`,
    ``,
    `Nažalost za ${i.desiredDateISO} nemamo slobodan termin.`,
    reason ? `Napomena: ${reason}` : "",
    ``,
    phone ? `Za drugi datum pozovite ${phone}.` : "",
    ``,
    `— L'Essenza`,
  ].filter(Boolean).join("\n");

  const inner = [
    paragraph(`Draga ${i.name},`),
    paragraph(`Nažalost za datum ${i.desiredDateISO} nemamo slobodan termin.`),
    reason ? softNote(reason) : "",
    phone ? paragraph(`Rado ćemo naći drugi datum — pozovite ${phone} pa ćemo dogovoriti.`) : "",
    signOff(),
  ].filter(Boolean).join("\n");

  return {
    to: i.email,
    subject: "L'Essenza — Upit",
    text,
    html: renderShell({ heading: "O Vašem upitu", preheader: `Datum ${i.desiredDateISO} nije dostupan`, inner }),
  };
}

export function dailyDigestToOwner(
  bookings: Booking[],
  nextDayLabel: string,
  ctx: OwnerTemplateCtx
): EmailMessage {
  const lines = bookings.length
    ? bookings
        .map((b) => `• ${formatSalon(new Date(b.startISO), "HH:mm")} — ${b.serviceName} — ${b.name} (${b.phoneE164})`)
        .join("\n")
    : "Nema zakazanih termina za sutra.";
  const adminUrl = `${ctx.siteUrl.replace(/\/$/, "")}/admin/`;
  const text = [
    `Podsjetnik za ${nextDayLabel}:`,
    ``,
    lines,
    ``,
    `Otvori u adminu: ${adminUrl}`,
  ].join("\n");

  const listHtml = bookings.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:16px 0;border:1px solid ${BRAND.champagne};border-radius:6px;background:${BRAND.creamSoft};">
        ${bookings.map((b) => `
          <tr>
            <td style="padding:14px 18px;border-bottom:1px solid ${BRAND.champagne};">
              <div style="font-family:'Playfair Display',Georgia,serif;font-size:18px;color:${BRAND.gold};">${esc(formatSalon(new Date(b.startISO), "HH:mm"))}</div>
              <div style="font-size:15px;color:${BRAND.sage};font-weight:500;margin-top:2px;">${esc(b.serviceName)}</div>
              <div style="font-size:13px;color:${BRAND.sageSoft};margin-top:2px;">${esc(b.name)} &middot; ${esc(b.phoneE164)}</div>
            </td>
          </tr>`).join("")}
        </table>`
    : `<p style="margin:16px 0;padding:20px;background:${BRAND.cream};text-align:center;color:${BRAND.sageSoft};border-radius:6px;">Nema zakazanih termina za sutra.</p>`;

  const inner = [
    paragraphRaw(`Raspored za <strong>${esc(nextDayLabel)}</strong>:`),
    listHtml,
    btnLink(adminUrl, "Otvori u adminu"),
  ].join("\n");

  return {
    to: ctx.ownerEmail,
    subject: `L'Essenza — Raspored za ${nextDayLabel}`,
    text,
    html: renderShell({ heading: "Raspored za sutra", preheader: `${bookings.length} termin(a) · ${nextDayLabel}`, inner }),
  };
}

export function reminderToClient(b: Booking, ctx: ClientTemplateCtx): EmailMessage {
  if (!b.email) throw new Error("Booking has no client email");
  const when = formatDateHuman(b.startISO);
  const phone = ctx.ownerPhone ? formatPhoneNational(ctx.ownerPhone) : "";
  const text = [
    `Zdravo ${b.name},`,
    ``,
    `Podsjećamo vas na sutrašnji termin:`,
    ``,
    `Usluga: ${b.serviceName}`,
    `Kada: ${when}`,
    `Gdje: ${ctx.salonAddress}`,
    ``,
    phone ? `Za izmjene pozovite ${phone}.` : "",
    ``,
    `— L'Essenza`,
  ].filter(Boolean).join("\n");

  const inner = [
    paragraph(`Draga ${b.name},`),
    paragraph(`Podsjećamo Vas na sutrašnji termin u L'Essenza.`),
    detailsTable([
      ["Usluga", b.serviceName],
      ["Kada", when],
      ["Gdje", ctx.salonAddress],
    ]),
    phone ? softNote(`Ako nešto iskrsne, pozovite ${phone} — dogovorićemo novi termin.`) : "",
    paragraph(`Vidimo se sutra!`),
    signOff(),
  ].filter(Boolean).join("\n");

  return {
    to: b.email,
    subject: "L'Essenza — Podsjetnik za sutra",
    text,
    html: renderShell({ heading: "Podsjetnik za sutra", preheader: `${b.serviceName} · ${when}`, inner }),
  };
}
