import type { EmailMessage } from "./mailer";
import type { Booking } from "./calendar-domain";
import { formatSalon } from "./time";

export interface ClientTemplateCtx {
  salonAddress: string;
  ownerPhone?: string;
  /** Owner-customized greeting used in the second paragraph of confirmations. */
  emailGreeting?: string;
  /** Owner-customized closing line shown above the signature. */
  emailClosing?: string;
  /** Owner-customized signature label shown after the em-dash. */
  emailSignature?: string;
}

/** Build a ClientTemplateCtx from a Settings-shaped object. */
export function clientCtx<T extends {
  salonAddress: string;
  ownerPhone?: string;
  emailGreeting?: string;
  emailClosing?: string;
  emailSignature?: string;
}>(s: T): ClientTemplateCtx {
  return {
    salonAddress: s.salonAddress,
    ownerPhone: s.ownerPhone,
    emailGreeting: s.emailGreeting,
    emailClosing: s.emailClosing,
    emailSignature: s.emailSignature,
  };
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
<body style="margin:0;padding:0;background:#FDF9F0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${BRAND.sage};">
<span style="display:none!important;opacity:0;color:transparent;max-height:0;max-width:0;visibility:hidden;overflow:hidden;">${pre}</span>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FDF9F0;">
<tr><td align="center" style="padding:36px 16px;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #EDE0C8;border-radius:14px;overflow:hidden;box-shadow:0 6px 20px rgba(201,169,97,0.08);">
    <tr>
      <td style="background:#FBF5E8;padding:38px 32px 22px;text-align:center;border-bottom:1px solid #EDE0C8;">
        <div style="font-family:Georgia,serif;color:${BRAND.gold};font-size:22px;letter-spacing:6px;margin-bottom:14px;opacity:0.55;">&#10086; &middot; &#10086;</div>
        <img src="https://lessenza.me/img/logo-wordmark.png" alt="L'Essenza Beauty Salon" width="230" style="display:inline-block;max-width:68%;height:auto;border:0;outline:none;text-decoration:none;">
        <div style="font-size:10px;letter-spacing:5px;color:${BRAND.sageSoft};text-transform:uppercase;margin-top:14px;">Beauty Salon &middot; Cetinje</div>
      </td>
    </tr>
    <tr>
      <td style="padding:42px 36px 10px;text-align:center;">
        <h1 style="font-family:'Playfair Display',Georgia,'Times New Roman',serif;font-size:26px;color:${BRAND.sage};margin:0;font-weight:400;line-height:1.3;letter-spacing:0.02em;">${esc(opts.heading)}</h1>
        <div style="margin:22px auto 4px;color:${BRAND.gold};font-family:Georgia,serif;font-size:14px;letter-spacing:8px;">&#10086;</div>
      </td>
    </tr>
    <tr>
      <td style="padding:12px 36px 32px;color:${BRAND.sage};font-size:15px;line-height:1.7;">
        ${opts.inner}
      </td>
    </tr>
    <tr>
      <td style="padding:0 36px 28px;text-align:center;">
        <div style="color:${BRAND.gold};font-family:Georgia,serif;font-size:14px;letter-spacing:8px;opacity:0.55;">&#10086;</div>
      </td>
    </tr>
    <tr>
      <td style="background:#FBF5E8;padding:24px 32px;text-align:center;border-top:1px solid #EDE0C8;">
        <div style="font-size:12px;color:${BRAND.sageSoft};line-height:1.7;letter-spacing:0.02em;">
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

function signOff(custom?: string): string {
  const label = custom?.trim() || "L'Essenza";
  return `<p style="margin:28px 0 0;color:${BRAND.sageSoft};font-family:'Playfair Display',Georgia,serif;font-size:16px;font-style:italic;text-align:center;">&mdash; ${esc(label)}</p>`;
}

/** Client-facing "reply to this email" CTA. Salon phone is intentionally
 *  NOT mentioned here — if the owner wants a phone shown publicly, she sets
 *  `publicPhone` in Settings and it surfaces on the website footer / contact
 *  page, not in automated client emails. */
function replyNote(): string {
  return softNote(`Za izmjene ili dodatna pitanja — jednostavno odgovorite na ovaj email.`);
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export function bookingConfirmedToClient(
  b: Booking,
  _ctx: ClientTemplateCtx & { cancelUrl?: string }
): EmailMessage {
  if (!b.email) throw new Error("Booking has no client email");
  const dateLine = formatDateHuman(b.startISO);
  const cancelUrl = _ctx.cancelUrl;
  const text = [
    `Zdravo ${b.name},`,
    ``,
    `Potvrda termina u L'Essenza Beauty Salon:`,
    ``,
    `Usluga: ${b.serviceName}`,
    `Kada: ${dateLine}`,
    `Gdje: ${_ctx.salonAddress}`,
    ``,
    cancelUrl
      ? `Ne mozete doci? Otkazi termin (najkasnije 24h prije):\n${cancelUrl}\n`
      : "",
    `Za izmjene — odgovorite na ovaj email.`,
    ``,
    `Vidimo se uskoro!`,
    `— L'Essenza`,
  ].filter(Boolean).join("\n");

  const cancelBlock = cancelUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:16px 0 8px;"><tr><td align="center">
        <a href="${esc(cancelUrl)}" style="display:inline-block;font-family:Georgia,serif;font-size:13px;color:${BRAND.gold};text-decoration:none;border:1px solid ${BRAND.gold};padding:9px 22px;border-radius:6px;letter-spacing:0.04em;">Otkazi termin</a>
        <div style="font-size:11px;color:${BRAND.sageSoft};margin-top:8px;">Otkazivanje moguce najkasnije 24h prije termina.</div>
      </td></tr></table>`
    : "";

  const greeting = _ctx.emailGreeting?.trim() || "Hvala što ste odabrali L'Essenza. Vaš termin je potvrđen.";
  const closing = _ctx.emailClosing?.trim() || "Radujemo se vašem dolasku.";
  const inner = [
    paragraph(`Zdravo ${b.name},`),
    paragraph(esc(greeting)),
    detailsTable([
      ["Usluga", b.serviceName],
      ["Kada", dateLine],
      ["Gdje", _ctx.salonAddress],
    ]),
    cancelBlock,
    replyNote(),
    paragraph(esc(closing)),
    signOff(_ctx.emailSignature),
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
  _ctx: ClientTemplateCtx
): EmailMessage {
  if (!b.email) throw new Error("Booking has no client email");
  const dateLine = formatDateHuman(b.startISO);
  const text = [
    `Zdravo ${b.name},`,
    ``,
    `Nažalost moramo otkazati vaš termin:`,
    ``,
    `Usluga: ${b.serviceName}`,
    `Kada: ${dateLine}`,
    reason ? `Razlog: ${reason}` : "",
    ``,
    `Za novi termin — odgovorite na ovaj email.`,
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
    softNote(`Odgovorite na ovaj email da dogovorimo novi termin koji Vam odgovara — biće nam drago da Vas ugostimo.`),
    signOff(_ctx?.emailSignature),
  ].filter(Boolean).join("\n");

  return {
    to: b.email,
    subject: "L'Essenza — Termin je otkazan",
    text,
    html: renderShell({ heading: "Termin je otkazan", preheader: `${b.serviceName} · ${dateLine}`, inner }),
  };
}

export function bookingRejectedToClient(b: Booking, _ctx: ClientTemplateCtx): EmailMessage {
  if (!b.email) throw new Error("rejected email requires booking.email");
  const when = formatDateHuman(b.startISO);
  const inner = `
    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;">Draga ${esc(b.name)},</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;">
      Hvala na interesovanju za <strong>L'Essenza</strong>.
    </p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;">
      Nažalost, u narednom periodu ne mogu prihvatiti Vaš termin za <strong>${esc(b.serviceName)}</strong> (${esc(when)}).
    </p>
    ${replyNote()}
    <p style="margin:24px 0 0;font-size:14px;color:${BRAND.sageSoft};">Srdačno ✿ L'Essenza</p>
  `;
  return {
    to: b.email,
    subject: `Termin — L'Essenza`,
    html: renderShell({ heading: "Obavještenje o terminu", preheader: "Nažalost termin nije moguć.", inner }),
    text:
      `Draga ${b.name},\n\n` +
      `Hvala na interesovanju za L'Essenza. Nažalost, u narednom periodu ne mogu prihvatiti Vaš termin za ${b.serviceName} (${when}).\n\n` +
      `Ako imate pitanja, slobodno odgovorite na ovaj email.\n\n` +
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
    `Za izmjene — odgovorite na ovaj email.`,
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
    softNote(`Ako Vam novi termin ne odgovara, odgovorite na ovaj email pa ćemo naći drugi.`),
    signOff(ctx?.emailSignature),
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
  const text = [
    `Zdravo ${i.name},`,
    ``,
    `Vaš upit je prihvaćen. Zakazan termin:`,
    ``,
    `Usluga: ${i.serviceName}`,
    `Kada: ${dateLine}`,
    `Gdje: ${ctx.salonAddress}`,
    ``,
    `Za izmjene — odgovorite na ovaj email.`,
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
    replyNote(),
    signOff(ctx?.emailSignature),
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
  _ctx: ClientTemplateCtx
): EmailMessage {
  if (!i.email) throw new Error("Inquiry has no client email");
  const text = [
    `Zdravo ${i.name},`,
    ``,
    `Nažalost za ${i.desiredDateISO} nemamo slobodan termin.`,
    reason ? `Napomena: ${reason}` : "",
    ``,
    `Za drugi datum — odgovorite na ovaj email.`,
    ``,
    `— L'Essenza`,
  ].filter(Boolean).join("\n");

  const inner = [
    paragraph(`Draga ${i.name},`),
    paragraph(`Nažalost za datum ${i.desiredDateISO} nemamo slobodan termin.`),
    reason ? softNote(reason) : "",
    paragraph(`Rado ćemo naći drugi datum — odgovorite na ovaj email pa ćemo dogovoriti.`),
    signOff(_ctx?.emailSignature),
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
  const text = [
    `Zdravo ${b.name},`,
    ``,
    `Podsjećamo vas na sutrašnji termin:`,
    ``,
    `Usluga: ${b.serviceName}`,
    `Kada: ${when}`,
    `Gdje: ${ctx.salonAddress}`,
    ``,
    `Ako nešto iskrsne — odgovorite na ovaj email.`,
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
    softNote(`Ako nešto iskrsne, odgovorite na ovaj email i dogovorićemo novi termin.`),
    paragraph(`Vidimo se sutra!`),
    signOff(ctx?.emailSignature),
  ].filter(Boolean).join("\n");

  return {
    to: b.email,
    subject: "L'Essenza — Podsjetnik za sutra",
    text,
    html: renderShell({ heading: "Podsjetnik za sutra", preheader: `${b.serviceName} · ${when}`, inner }),
  };
}

/**
 * Owner-facing notification when a client self-cancels via the public link.
 * The corresponding `bookingCancelledToClient` template (admin-initiated)
 * already lives above; this one is the inverse — owner is the recipient.
 */
export function bookingCancelledByClientToOwner(
  b: Booking,
  ctx: { ownerEmail: string }
): EmailMessage {
  const when = formatDateHuman(b.startISO);
  const phoneLine = b.phoneE164 ? `Telefon: ${b.phoneE164}` : "Telefon: —";
  const emailLine = b.email ? `Email: ${b.email}` : "Email: —";
  const text = [
    `Klijentkinja je sama otkazala termin preko sajta.`,
    ``,
    `Termin: ${b.serviceName}`,
    `Klijentkinja: ${b.name}`,
    phoneLine,
    emailLine,
    `Bio zakazan: ${when}`,
    ``,
    `Slot je sad slobodan u Google kalendaru.`,
    ``,
    `— L'Essenza booking sistem`,
  ].join("\n");

  const inner = [
    paragraph(`<strong>Klijentkinja je sama otkazala termin preko sajta.</strong>`),
    detailsTable([
      ["Termin", b.serviceName],
      ["Klijentkinja", b.name],
      ["Telefon", b.phoneE164 || "—"],
      ["Email", b.email || "—"],
      ["Bio zakazan", when],
    ]),
    softNote(`Slot je sad slobodan u Google kalendaru.`),
  ].filter(Boolean).join("\n");

  return {
    to: ctx.ownerEmail,
    subject: `Otkazan termin — ${b.name}, ${b.serviceName}`,
    text,
    html: renderShell({ heading: "Termin otkazan", preheader: `${b.name} · ${when}`, inner }),
  };
}

/** Sent ~4h after a booking ends, asking for a Google review. */
export function reviewNudgeToClient(
  b: Booking,
  ctx: ClientTemplateCtx & { reviewLinkUrl: string }
): EmailMessage {
  if (!b.email) throw new Error("Booking has no client email");
  const url = ctx.reviewLinkUrl;
  const cta = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:18px 0 8px;"><tr><td align="center">
    <a href="${esc(url)}" style="display:inline-block;font-family:Georgia,serif;font-size:14px;color:#fff;text-decoration:none;background:linear-gradient(135deg,${BRAND.gold} 0%,${BRAND.goldLight} 100%);padding:12px 24px;border-radius:8px;letter-spacing:0.04em;">Ostavi recenziju &raquo;</a>
  </td></tr></table>`;

  const inner = [
    paragraph(`Draga ${b.name},`),
    paragraph(`Hvala što ste danas posjetili L'Essenzu. Bilo nam je drago.`),
    paragraph(`Ako imate jedan minut — vaš utisak na <strong>Google-u</strong> nam mnogo znači. Pomaže drugim klijentkinjama koje traže salon u Cetinju.`),
    cta,
    softNote(`Ako vam se nešto nije svidjelo, jednostavno odgovorite na ovaj email — uzećemo to ozbiljno.`),
    signOff(ctx.emailSignature),
  ].filter(Boolean).join("\n");

  return {
    to: b.email,
    subject: "L'Essenza — Hvala što ste bili",
    text:
      `Draga ${b.name},\n\n` +
      `Hvala što ste danas posjetili L'Essenzu.\n\n` +
      `Ako imate jedan minut, vaš utisak nam mnogo znači:\n${url}\n\n` +
      `Srdačno,\n${ctx.emailSignature || "L'Essenza"}`,
    html: renderShell({ heading: "Hvala vam", preheader: "Vaš utisak nam mnogo znači", inner }),
  };
}
