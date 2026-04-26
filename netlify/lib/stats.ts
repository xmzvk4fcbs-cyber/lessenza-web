// Pure month-summary aggregation. Caller fetches events + services + no-shows
// and passes them in.

import type { Service } from "./schemas";

export interface StatBooking {
  startISO: string;
  endISO?: string;
  serviceId?: string;
  serviceName?: string;
  phoneE164?: string;
}

export interface StatNoShow {
  dateISO: string;
}

export interface MonthlyStats {
  month: string;            // "YYYY-MM"
  bookingsCount: number;
  noShowCount: number;
  revenueEstimate: number | null; // null if no priced services
  topServices: { name: string; count: number }[];
  busiestDow: { dow: number; label: string; avgPerDay: number } | null;  // 0=Mon..6=Sun
  busiestHour: { hour: number; count: number } | null;                   // 0..23
  newClients: number;
  returningClients: number;
}

const DOW_LABEL = ["Ponedjeljak", "Utorak", "Srijeda", "Četvrtak", "Petak", "Subota", "Nedjelja"];

function monKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function dowMon(d: Date): number { return (d.getDay() + 6) % 7; }

/**
 * Compute monthly statistics. `bookingsInMonth` are bookings whose startISO
 * falls in the target month. `pastBookingsBeforeMonth` are bookings BEFORE
 * the target month (used to identify returning clients).
 */
export function summarizeMonth(
  monthKey: string, // "YYYY-MM"
  bookingsInMonth: StatBooking[],
  pastBookingsBeforeMonth: StatBooking[],
  noShowsInMonth: StatNoShow[],
  services: Service[]
): MonthlyStats {
  const [y, m] = monthKey.split("-").map(Number);
  if (!y || !m) {
    return {
      month: monthKey,
      bookingsCount: 0,
      noShowCount: 0,
      revenueEstimate: null,
      topServices: [],
      busiestDow: null,
      busiestHour: null,
      newClients: 0,
      returningClients: 0,
    };
  }

  const bookingsCount = bookingsInMonth.length;
  const noShowCount = noShowsInMonth.length;

  // Service histogram + revenue estimate.
  const serviceById = new Map(services.map((s) => [s.id, s]));
  const serviceCounts = new Map<string, number>();
  let pricedAny = false;
  let revenue = 0;
  for (const b of bookingsInMonth) {
    const name = (b.serviceName || (b.serviceId && serviceById.get(b.serviceId)?.name) || "").trim();
    if (name) serviceCounts.set(name, (serviceCounts.get(name) ?? 0) + 1);
    const svc = b.serviceId ? serviceById.get(b.serviceId) : undefined;
    if (svc?.price != null && svc.price > 0) {
      pricedAny = true;
      revenue += svc.price;
    }
  }
  const topServices = [...serviceCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  // Day-of-week histogram + average per occurrence in this month.
  const dowCounts = new Array<number>(7).fill(0);
  const dowOccurrences = new Array<number>(7).fill(0);
  // Count how many of each DOW occur in this month (e.g. April 2026 has 4 Mondays).
  const lastDay = new Date(y, m, 0).getDate();
  for (let day = 1; day <= lastDay; day++) {
    dowOccurrences[dowMon(new Date(y, m - 1, day))]!++;
  }
  for (const b of bookingsInMonth) {
    const d = new Date(b.startISO);
    dowCounts[dowMon(d)]!++;
  }
  let busiestDowIdx = -1;
  let bestAvg = 0;
  for (let i = 0; i < 7; i++) {
    if (dowOccurrences[i]! === 0) continue;
    const avg = dowCounts[i]! / dowOccurrences[i]!;
    if (avg > bestAvg) { bestAvg = avg; busiestDowIdx = i; }
  }
  const busiestDow = busiestDowIdx >= 0 && bestAvg > 0
    ? { dow: busiestDowIdx, label: DOW_LABEL[busiestDowIdx]!, avgPerDay: Math.round(bestAvg * 10) / 10 }
    : null;

  // Busiest hour-of-day.
  const hourCounts = new Array<number>(24).fill(0);
  for (const b of bookingsInMonth) {
    const d = new Date(b.startISO);
    hourCounts[d.getHours()]!++;
  }
  let busiestHour: MonthlyStats["busiestHour"] = null;
  let bestHourCount = 0;
  for (let h = 0; h < 24; h++) {
    if (hourCounts[h]! > bestHourCount) {
      bestHourCount = hourCounts[h]!;
      busiestHour = { hour: h, count: hourCounts[h]! };
    }
  }

  // New vs returning clients (by phoneE164).
  const seenBefore = new Set<string>();
  for (const b of pastBookingsBeforeMonth) {
    if (b.phoneE164) seenBefore.add(b.phoneE164);
  }
  const monthPhones = new Set<string>();
  for (const b of bookingsInMonth) if (b.phoneE164) monthPhones.add(b.phoneE164);
  let newClients = 0;
  let returningClients = 0;
  for (const p of monthPhones) {
    if (seenBefore.has(p)) returningClients++;
    else newClients++;
  }

  return {
    month: monthKey,
    bookingsCount,
    noShowCount,
    revenueEstimate: pricedAny ? Math.round(revenue) : null,
    topServices,
    busiestDow,
    busiestHour,
    newClients,
    returningClients,
  };
}

export { monKey };
