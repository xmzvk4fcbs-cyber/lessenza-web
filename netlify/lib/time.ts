import { formatInTimeZone, toZonedTime, fromZonedTime } from "date-fns-tz";

export const TZ = "Europe/Podgorica";

export type Weekday = "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";

export function nowInTZ(): Date {
  return new Date();
}

export function toTZ(utc: Date): Date {
  return toZonedTime(utc, TZ);
}

export function fromTZ(dateKey: string, hhmm: string): Date {
  // dateKey "YYYY-MM-DD", hhmm "HH:MM" — interpreted in TZ, returned as UTC Date
  const iso = `${dateKey}T${hhmm}:00`;
  return fromZonedTime(iso, TZ);
}

export function dayKeyInTZ(d: Date): string {
  return formatInTimeZone(d, TZ, "yyyy-MM-dd");
}

export function weekdayInTZ(d: Date): Weekday {
  const name = formatInTimeZone(d, TZ, "EEEE").toLowerCase() as Weekday;
  return name;
}

export function addMinutesISO(iso: string, minutes: number): string {
  const d = new Date(iso);
  d.setTime(d.getTime() + minutes * 60_000);
  return d.toISOString();
}

export function formatSalon(d: Date, pattern: string): string {
  return formatInTimeZone(d, TZ, pattern);
}
