import { z } from "zod";

const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;

export const ServiceSchema = z.object({
  id: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(80),
  durationMinutes: z.number().int().positive().max(600),
  active: z.boolean(),
  notes: z.string().max(500).optional(),
});
export type Service = z.infer<typeof ServiceSchema>;
export const ServicesSchema = z.array(ServiceSchema);

export const ParallelPairSchema = z
  .object({
    serviceIdA: z.string().min(1),
    serviceIdB: z.string().min(1),
  })
  .refine((p) => p.serviceIdA !== p.serviceIdB, { message: "pair must be two different services" });
export type ParallelPair = z.infer<typeof ParallelPairSchema>;
export const ParallelPairsSchema = z.array(ParallelPairSchema);

const DayHoursSchema = z.union([
  z.object({ open: z.literal(false) }),
  z.object({
    open: z.literal(true),
    from: z.string().regex(hhmm),
    to: z.string().regex(hhmm),
  }).refine((d) => d.from < d.to, { message: "from must be before to" }),
]);
export type DayHours = z.infer<typeof DayHoursSchema>;

export const WorkingHoursSchema = z.object({
  monday: DayHoursSchema,
  tuesday: DayHoursSchema,
  wednesday: DayHoursSchema,
  thursday: DayHoursSchema,
  friday: DayHoursSchema,
  saturday: DayHoursSchema,
  sunday: DayHoursSchema,
});
export type WorkingHours = z.infer<typeof WorkingHoursSchema>;

export const BlockSchema = z
  .object({
    id: z.string().min(1),
    startISO: z.string().datetime(),
    endISO: z.string().datetime(),
    reason: z.string().max(200).optional(),
  })
  .refine((b) => new Date(b.startISO) < new Date(b.endISO), { message: "start before end" });
export type Block = z.infer<typeof BlockSchema>;
export const BlocksSchema = z.array(BlockSchema);

export const SettingsSchema = z.object({
  bookingWindowDays: z.number().int().min(1).max(365).default(15),
  minLeadHours: z.number().min(0).max(720).default(2),
  bufferMinutes: z.number().int().min(0).max(120).default(5),
  slotGranularityMinutes: z.number().int().min(5).max(60).default(15),
  reminderEmailEnabled: z.boolean().default(true),
  dailyDigestEnabled: z.boolean().default(true),
  defaultCountryCode: z.string().regex(/^\+\d{1,4}$/).default("+382"),
  salonAddress: z.string().default("Bajova 22"),
  ownerEmail: z.string().email().optional(),
  ownerPhone: z.string().optional(),
  mailer: z.enum(["resend", "gmail"]).default("resend"),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const InquirySchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().datetime(),
  name: z.string().min(1).max(120),
  phone: z.string().min(4).max(32),
  email: z.string().email().optional(),
  serviceId: z.string().min(1),
  desiredDateISO: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  desiredTimeWindow: z.enum(["morning", "afternoon", "any"]),
  note: z.string().max(1000).optional(),
  status: z.enum(["pending", "accepted", "declined"]),
});
export type Inquiry = z.infer<typeof InquirySchema>;

export const AdminAuthSchema = z.object({
  passwordHash: z.string(),
  jwtSecret: z.string(),
  createdAt: z.string().datetime(),
});
export type AdminAuth = z.infer<typeof AdminAuthSchema>;
