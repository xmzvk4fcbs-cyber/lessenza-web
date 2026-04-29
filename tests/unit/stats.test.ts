import { describe, it, expect } from "vitest";
import { summarizeMonth, type StatBooking, type StatNoShow } from "../../netlify/lib/stats";
import type { Service } from "../../netlify/lib/schemas";

const services: Service[] = [
  { id: "manikir", name: "Manikir", durationMinutes: 60, active: true, price: 15 },
  { id: "pedikir", name: "Pedikir", durationMinutes: 45, active: true, price: 20 },
  { id: "laser",   name: "Laser",   durationMinutes: 30, active: true }, // no price
];

describe("summarizeMonth", () => {
  it("returns zero-shaped output for an empty month", () => {
    const r = summarizeMonth("2026-04", [], [], [], [], services);
    expect(r.bookingsCount).toBe(0);
    expect(r.topServices).toEqual([]);
    expect(r.busiestDow).toBeNull();
    expect(r.busiestHour).toBeNull();
    expect(r.revenueEstimate).toBeNull();
    expect(r.newClients).toBe(0);
    expect(r.returningClients).toBe(0);
  });

  it("counts bookings + builds service histogram", () => {
    const b: StatBooking[] = [
      { startISO: "2026-04-06T09:00:00", serviceId: "manikir", serviceName: "Manikir", phoneE164: "+1" },
      { startISO: "2026-04-13T09:00:00", serviceId: "manikir", serviceName: "Manikir", phoneE164: "+2" },
      { startISO: "2026-04-15T11:00:00", serviceId: "pedikir", serviceName: "Pedikir", phoneE164: "+3" },
      { startISO: "2026-04-20T10:00:00", serviceId: "laser",   serviceName: "Laser",   phoneE164: "+4" },
    ];
    const r = summarizeMonth("2026-04", b, [], [], [], services);
    expect(r.bookingsCount).toBe(4);
    expect(r.topServices[0]).toEqual({ name: "Manikir", count: 2 });
    expect(r.topServices.find((x) => x.name === "Laser")?.count).toBe(1);
  });

  it("revenue estimate sums priced services only (null if none priced)", () => {
    const b: StatBooking[] = [
      { startISO: "2026-04-06T09:00:00", serviceId: "manikir" }, // 15€
      { startISO: "2026-04-07T09:00:00", serviceId: "manikir" }, // 15€
      { startISO: "2026-04-08T09:00:00", serviceId: "pedikir" }, // 20€
      { startISO: "2026-04-09T09:00:00", serviceId: "laser"   }, // no price
    ];
    const r = summarizeMonth("2026-04", b, [], [], [], services);
    expect(r.revenueEstimate).toBe(50);

    // If no priced services, revenue is null (not 0).
    const onlyLaser: StatBooking[] = [
      { startISO: "2026-04-06T09:00:00", serviceId: "laser" },
    ];
    const r2 = summarizeMonth("2026-04", onlyLaser, [], [], [], services);
    expect(r2.revenueEstimate).toBeNull();
  });

  it("identifies busiest day-of-week (avg per occurrence)", () => {
    // April 2026 has 4 Mondays (6,13,20,27). Put 3 bookings on Mondays = avg 0.75.
    // Tuesdays: 1 booking on 1 of 4 Tuesdays = avg 0.25.
    const b: StatBooking[] = [
      { startISO: "2026-04-06T09:00:00", serviceId: "manikir" },
      { startISO: "2026-04-13T09:00:00", serviceId: "manikir" },
      { startISO: "2026-04-20T09:00:00", serviceId: "manikir" },
      { startISO: "2026-04-07T09:00:00", serviceId: "manikir" },
    ];
    const r = summarizeMonth("2026-04", b, [], [], [], services);
    expect(r.busiestDow?.label).toBe("Ponedjeljak");
    expect(r.busiestDow?.avgPerDay).toBe(0.8); // 3 / 4 = 0.75 → rounded 0.8
  });

  it("identifies busiest hour", () => {
    const b: StatBooking[] = [
      { startISO: "2026-04-06T09:30:00", serviceId: "manikir" }, // hour 9
      { startISO: "2026-04-07T09:00:00", serviceId: "manikir" }, // hour 9
      { startISO: "2026-04-08T09:15:00", serviceId: "manikir" }, // hour 9
      { startISO: "2026-04-09T14:00:00", serviceId: "manikir" }, // hour 14
    ];
    const r = summarizeMonth("2026-04", b, [], [], [], services);
    expect(r.busiestHour?.hour).toBe(9);
    expect(r.busiestHour?.count).toBe(3);
  });

  it("counts new vs returning clients by phoneE164", () => {
    const past: StatBooking[] = [
      { startISO: "2026-03-01T10:00:00", phoneE164: "+1" },
      { startISO: "2026-02-01T10:00:00", phoneE164: "+2" },
    ];
    const month: StatBooking[] = [
      { startISO: "2026-04-06T09:00:00", phoneE164: "+1" }, // returning
      { startISO: "2026-04-07T09:00:00", phoneE164: "+3" }, // new
      { startISO: "2026-04-08T09:00:00", phoneE164: "+4" }, // new
      { startISO: "2026-04-09T09:00:00", phoneE164: "+1" }, // still returning (dedup)
    ];
    const r = summarizeMonth("2026-04", month, past, [], [], services);
    expect(r.returningClients).toBe(1);
    expect(r.newClients).toBe(2);
  });

  it("counts no-shows", () => {
    const ns: StatNoShow[] = [
      { dateISO: "2026-04-05T09:00:00" },
      { dateISO: "2026-04-12T09:00:00" },
    ];
    const r = summarizeMonth("2026-04", [], [], ns, [], services);
    expect(r.noShowCount).toBe(2);
  });
});
