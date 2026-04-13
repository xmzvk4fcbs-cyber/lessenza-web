import type { Service, WorkingHours, ParallelPair } from "./schemas";

export const DEFAULT_SERVICES: Service[] = [
  { id: "body-sculpt", name: "Body Sculpt", durationMinutes: 60, active: true },
  { id: "laserska-epilacija", name: "Laserska Epilacija", durationMinutes: 30, active: true },
  { id: "manikir-klasican", name: "Manikir - Klasičan", durationMinutes: 45, active: true },
  { id: "manikir-gel", name: "Manikir - Gel", durationMinutes: 60, active: true },
  { id: "manikir-spa", name: "Manikir - SPA", durationMinutes: 75, active: true },
  { id: "pedikir-klasican", name: "Pedikir - Klasičan", durationMinutes: 45, active: true },
  { id: "pedikir-spa", name: "Pedikir - SPA", durationMinutes: 75, active: true },
  { id: "depilacija", name: "Depilacija", durationMinutes: 30, active: true },
  { id: "konsultacija", name: "Besplatna konsultacija", durationMinutes: 20, active: true },
];

export const DEFAULT_WORKING_HOURS: WorkingHours = {
  monday: { open: true, from: "09:00", to: "18:00" },
  tuesday: { open: true, from: "09:00", to: "18:00" },
  wednesday: { open: true, from: "09:00", to: "18:00" },
  thursday: { open: true, from: "09:00", to: "18:00" },
  friday: { open: true, from: "09:00", to: "18:00" },
  saturday: { open: true, from: "09:00", to: "14:00" },
  sunday: { open: false },
};

export const DEFAULT_PARALLEL_PAIRS: ParallelPair[] = [];
