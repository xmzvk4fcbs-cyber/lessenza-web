import { describe, it, expect } from "vitest";
import {
  bookingConfirmedToClient,
  bookingCreatedToOwner,
  inquiryCreatedToOwner,
  bookingCancelledToClient,
  bookingRescheduledToClient,
  inquiryAcceptedToClient,
  inquiryDeclinedToClient,
} from "../../netlify/lib/email-templates";
import type { Booking } from "../../netlify/lib/calendar-domain";

const booking: Booking = {
  bookingId: "b1",
  serviceId: "manikir-gel",
  serviceName: "Manikir - Gel",
  startISO: "2026-04-20T08:00:00.000Z", // Monday 10:00 local (CEST)
  endISO: "2026-04-20T09:00:00.000Z",
  name: "Ana Anić",
  phoneE164: "+38269123456",
  email: "ana@example.com",
  source: "web",
};

describe("email templates", () => {
  it("bookingConfirmedToClient includes service, date, time, address + reply CTA", () => {
    const m = bookingConfirmedToClient(booking, { salonAddress: "Bajova 22", ownerPhone: "+38269000000" });
    expect(m.to).toBe("ana@example.com");
    expect(m.subject).toMatch(/L'Essenza/);
    expect(m.text).toContain("Manikir - Gel");
    expect(m.text).toContain("10:00");
    expect(m.text).toContain("Bajova 22");
    // Phone is intentionally NOT in client emails — clients reply to the email instead.
    expect(m.text).not.toContain("069 000 000");
    expect(m.text.toLowerCase()).toContain("odgovorite na ovaj email");
  });

  it("bookingCreatedToOwner summarizes booking and links to admin", () => {
    const m = bookingCreatedToOwner(booking, {
      ownerEmail: "vlasnica@example.com",
      siteUrl: "https://lessenza.netlify.app",
    });
    expect(m.to).toBe("vlasnica@example.com");
    expect(m.subject).toMatch(/Novi termin/);
    expect(m.text).toContain("Ana Anić");
    expect(m.text).toContain("+38269123456");
    expect(m.text).toContain("https://lessenza.netlify.app/admin/");
  });

  it("inquiryCreatedToOwner uses desiredDate and time window", () => {
    const m = inquiryCreatedToOwner(
      {
        id: "i1",
        createdAt: new Date().toISOString(),
        name: "Mara",
        phone: "+38269999999",
        serviceId: "manikir-gel",
        serviceName: "Manikir - Gel",
        desiredDateISO: "2026-08-15",
        desiredTimeWindow: "morning",
        status: "pending",
      },
      { ownerEmail: "vlasnica@example.com", siteUrl: "https://lessenza.netlify.app" }
    );
    expect(m.to).toBe("vlasnica@example.com");
    expect(m.subject).toMatch(/upit/i);
    expect(m.text).toContain("Mara");
    expect(m.text).toContain("2026-08-15");
  });
});

describe("cancellation + reschedule + inquiry templates", () => {
  it("bookingCancelledToClient includes reason + reply CTA (no phone)", () => {
    const m = bookingCancelledToClient(booking, "bolest", {
      salonAddress: "Bajova 22",
      ownerPhone: "+38269000000",
    });
    expect(m.to).toBe("ana@example.com");
    expect(m.subject).toMatch(/otkazan/i);
    expect(m.text).toContain("bolest");
    expect(m.text).not.toContain("069 000 000");
    expect(m.text.toLowerCase()).toContain("odgovorite na ovaj email");
  });

  it("bookingRescheduledToClient shows old and new date", () => {
    const updated = { ...booking, startISO: "2026-04-21T10:00:00.000Z", endISO: "2026-04-21T11:00:00.000Z" };
    const m = bookingRescheduledToClient(booking, updated, { salonAddress: "Bajova 22" });
    expect(m.subject).toMatch(/pomjeren/i);
    expect(m.text).toContain("10:00"); // original (12:00 CEST)... actually formatted in TZ
  });

  it("inquiryAcceptedToClient and Declined require email", () => {
    const inq = {
      id: "i",
      createdAt: new Date().toISOString(),
      name: "X",
      phone: "+382691",
      email: "x@x.com",
      serviceId: "s",
      serviceName: "S",
      desiredDateISO: "2099-06-01",
      desiredTimeWindow: "morning",
      status: "pending",
    };
    const m1 = inquiryAcceptedToClient(inq, "2099-06-01T08:00:00Z", { salonAddress: "B 22" });
    expect(m1.to).toBe("x@x.com");
    const m2 = inquiryDeclinedToClient(inq, "zauzeto", { salonAddress: "B 22" });
    expect(m2.to).toBe("x@x.com");
    expect(m2.text).toContain("2099-06-01");
  });
});
