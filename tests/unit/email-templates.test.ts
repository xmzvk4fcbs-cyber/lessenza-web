import { describe, it, expect } from "vitest";
import {
  bookingConfirmedToClient,
  bookingCreatedToOwner,
  inquiryCreatedToOwner,
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
  it("bookingConfirmedToClient includes service, date, time, address", () => {
    const m = bookingConfirmedToClient(booking, { salonAddress: "Bajova 22", ownerPhone: "+38269000000" });
    expect(m.to).toBe("ana@example.com");
    expect(m.subject).toMatch(/L'Essenza/);
    expect(m.text).toContain("Manikir - Gel");
    expect(m.text).toContain("10:00");
    expect(m.text).toContain("Bajova 22");
    expect(m.text).toContain("069 000 000");
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
