// Pure functions to summarize a client's past appointments.
// Caller fetches Google Calendar events + the private note, then passes them in.

export interface PastVisit {
  startISO: string;
  serviceName?: string;
  status?: "confirmed" | "cancelled";
}

export interface HistorySummary {
  visitCount: number;
  cancellationCount: number;
  firstVisitISO?: string;
  lastVisitISO?: string;
  avgIntervalWeeks?: number;
  topServices: { name: string; count: number }[];
}

export function summarizeClientHistory(visits: PastVisit[]): HistorySummary {
  const confirmed = visits
    .filter((v) => v.status !== "cancelled")
    .sort((a, b) => a.startISO.localeCompare(b.startISO));
  const cancellationCount = visits.filter((v) => v.status === "cancelled").length;

  if (confirmed.length === 0) {
    return { visitCount: 0, cancellationCount, topServices: [] };
  }

  const first = confirmed[0]!.startISO;
  const last = confirmed[confirmed.length - 1]!.startISO;

  // Average interval: only meaningful when 2+ visits.
  let avgIntervalWeeks: number | undefined;
  if (confirmed.length >= 2) {
    const deltas: number[] = [];
    for (let i = 1; i < confirmed.length; i++) {
      const cur = confirmed[i]!;
      const prev = confirmed[i - 1]!;
      const ms = new Date(cur.startISO).getTime() - new Date(prev.startISO).getTime();
      deltas.push(ms / (7 * 24 * 60 * 60 * 1000));
    }
    if (deltas.length > 0) {
      const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
      avgIntervalWeeks = Math.round(avg * 10) / 10;
    }
  }

  // Service histogram, sorted by count desc, top 3.
  const counts = new Map<string, number>();
  for (const v of confirmed) {
    const name = (v.serviceName || "").trim();
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const topServices = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  return {
    visitCount: confirmed.length,
    cancellationCount,
    firstVisitISO: first,
    lastVisitISO: last,
    avgIntervalWeeks,
    topServices,
  };
}
