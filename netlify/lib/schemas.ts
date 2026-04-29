import { z } from "zod";

const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;

export const ServiceSchema = z.object({
  id: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(80),
  durationMinutes: z.number().int().positive().max(600),
  active: z.boolean(),
  notes: z.string().max(500).optional(),
  /** Price in EUR. Shown publicly only when Settings.showPrices is true. */
  price: z.number().min(0).max(100000).optional(),
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

const TimeWindowSchema = z
  .object({
    from: z.string().regex(hhmm),
    to: z.string().regex(hhmm),
  })
  .refine((w) => w.from < w.to, { message: "from must be before to" });

const DayHoursSchema = z.union([
  z.object({ open: z.literal(false) }),
  // Legacy single-window shape (kept for backwards compat; UI can normalize to windows[]).
  z.object({
    open: z.literal(true),
    from: z.string().regex(hhmm),
    to: z.string().regex(hhmm),
    windows: z.undefined().optional(),
  }).refine((d) => d.from < d.to, { message: "from must be before to" }),
  // Split-shift: two or more windows per day (e.g. 09:00–13:00 and 16:00–20:00).
  z.object({
    open: z.literal(true),
    windows: z.array(TimeWindowSchema).min(1).max(4),
  }),
]);
export type DayHours = z.infer<typeof DayHoursSchema>;
export type TimeWindow = z.infer<typeof TimeWindowSchema>;

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
  bufferMinutes: z.number().int().min(0).max(120).default(0),
  slotGranularityMinutes: z.number().int().min(5).max(60).default(15),
  reminderEmailEnabled: z.boolean().default(true),
  dailyDigestEnabled: z.boolean().default(true),
  defaultCountryCode: z.string().regex(/^\+\d{1,4}$/).default("+382"),
  salonAddress: z.string().default("Bajova 22"),
  salonCity: z.string().default("Cetinje"),
  mapQuery: z.string().default("Bajova 22, Cetinje, Montenegro"),
  ownerEmail: z.string().email().optional(),
  ownerPhone: z.string().optional(),
  publicPhone: z.string().optional(),
  publicEmail: z.string().email().optional(),
  whatsappPhone: z.string().optional(),
  instagramUrl: z.string().url().optional(),
  tagline: z.string().default("Beauty Salon · Bajova 22"),
  // Free-form display-only hours shown on public site (e.g. on kontakt page
  // and for inspection posting). Falls back to rendered operational hours
  // when empty. Overrides operational hours purely for display.
  displayHoursOverride: z.string().max(500).optional(),
  mailer: z.enum(["resend", "gmail", "smtp"]).default("resend"),
  /** When true, public usluge/zakazivanje show the `price` field next to each service. */
  showPrices: z.boolean().default(false),
  /** Currency label shown next to price. */
  priceCurrency: z.string().max(4).default("€"),
  /** When true, the /galerija.html "Prije / Poslije" tab is visible. */
  showBeforeAfter: z.boolean().default(false),

  /** Optional analytics snippet (e.g. Plausible / Cloudflare / Umami <script> tag) injected on every public page. */
  analyticsScript: z.string().max(2000).optional(),

  /** Email template overrides — when set, these strings replace the
   *  default greeting/closing/signature in all client-facing emails. */
  emailGreeting: z.string().max(500).optional(),
  emailClosing: z.string().max(500).optional(),
  emailSignature: z.string().max(200).optional(),

  /** Promotional banner shown at the top of every public page when non-empty. */
  bannerText: z.string().max(200).optional(),
  bannerLinkUrl: z.string().url().optional(),
  bannerLinkText: z.string().max(40).optional(),

  /** Send an automated Google review nudge ~4h after a booking ends. */
  reviewNudgeEnabled: z.boolean().default(false),
  /** Public URL clients click to leave the Google review (e.g. https://g.page/r/...). */
  reviewLinkUrl: z.string().url().optional(),

  /** Pametni predlozi — per-category toggles on the admin dashboard. */
  suggestLapsedRegulars: z.boolean().default(true),
  suggestSparseDays: z.boolean().default(true),
  suggestFutureGaps: z.boolean().default(true),
  suggestInquiryMatches: z.boolean().default(true),
});

/** A single dismissed suggestion entry (kind:id → when dismissed). */
export const DismissedSuggestionSchema = z.object({
  id: z.string().min(1).max(200),
  dismissedAt: z.string().datetime(),
});
export type DismissedSuggestion = z.infer<typeof DismissedSuggestionSchema>;
export const DismissedSuggestionsSchema = z.array(DismissedSuggestionSchema);

/** Owner-only private note attached to a client by phoneE164. Never sent to clients. */
export const ClientNoteSchema = z.object({
  phoneE164: z.string().min(4).max(32),
  text: z.string().max(1000).default(""),
  updatedAt: z.string().datetime(),
});
export type ClientNote = z.infer<typeof ClientNoteSchema>;

/** A single "klijentkinja nije došla" event. Stored per-phone in an array. */
export const NoShowSchema = z.object({
  eventId: z.string().min(1).max(200),
  dateISO: z.string().datetime(),
  serviceName: z.string().max(80).optional(),
  name: z.string().max(120).optional(),
  markedAt: z.string().datetime(),
});
export type NoShow = z.infer<typeof NoShowSchema>;
export const NoShowsSchema = z.array(NoShowSchema);

/** A single cancellation log entry. Append-only history of every booking that
 *  was cancelled — by admin, by client, rejected, or marked no-show. */
export const CancellationLogEntrySchema = z.object({
  /** Google Calendar event id at the time of cancellation. */
  eventId: z.string().min(1).max(200),
  /** When the appointment was scheduled (its startISO). */
  appointmentISO: z.string().datetime(),
  /** When this cancellation was recorded. */
  cancelledAt: z.string().datetime(),
  /** Who triggered it. */
  kind: z.enum(["by-client", "by-admin", "rejected", "no-show"]),
  /** Optional human reason (admin-supplied). */
  reason: z.string().max(200).optional(),
  name: z.string().max(120).optional(),
  phoneE164: z.string().max(32).optional(),
  serviceName: z.string().max(80).optional(),
});
export type CancellationLogEntry = z.infer<typeof CancellationLogEntrySchema>;
export const CancellationLogSchema = z.array(CancellationLogEntrySchema);
export type Settings = z.infer<typeof SettingsSchema>;

// ----- Gallery results (Prije / Poslije) -----
export const GalleryResultSchema = z.object({
  id: z.string().min(1).max(64),
  beforeUrl: z.string().min(1).max(300),
  afterUrl: z.string().min(1).max(300),
  caption: z.string().max(200).optional(),
  service: z.string().max(80).optional(),
  createdAt: z.string().datetime(),
  /** When set, item is in the trash. After 15 days it's purged from disk + DB. */
  deletedAt: z.string().datetime().optional(),
});
export type GalleryResult = z.infer<typeof GalleryResultSchema>;
export const GalleryResultsSchema = z.array(GalleryResultSchema);

// ----- Reviews (recenzije klijenata) -----
export const ReviewSchema = z.object({
  id: z.string().min(1).max(64),
  /** Display name — anonimno OK ("M.V., Cetinje"). */
  author: z.string().min(1).max(120),
  /** Citat. */
  text: z.string().min(1).max(1500),
  /** Optional 1–5 star rating. */
  rating: z.number().int().min(1).max(5).optional(),
  /** Optional photo URL — uploaded image (/uploads/reviews/…) or external. */
  photoUrl: z.string().min(1).max(300).optional(),
  /** Optional service tag ("Body Sculpt", "Manikir"). */
  service: z.string().max(80).optional(),
  /** Whether to show on public site. Defaults true. */
  published: z.boolean().default(true),
  createdAt: z.string().datetime(),
  /** When set, item is in trash; purged after 15 days. */
  deletedAt: z.string().datetime().optional(),
});
export type Review = z.infer<typeof ReviewSchema>;
export const ReviewsSchema = z.array(ReviewSchema);

// ----- Gallery items (obične slike u galeriji) -----
export const GalleryItemSchema = z.object({
  id: z.string().min(1).max(64),
  url: z.string().min(1).max(300),
  alt: z.string().max(200).optional(),
  createdAt: z.string().datetime(),
  deletedAt: z.string().datetime().optional(),
});
export type GalleryItem = z.infer<typeof GalleryItemSchema>;
export const GalleryItemsSchema = z.array(GalleryItemSchema);

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

export const BlockedPhoneSchema = z.object({
  phoneE164: z.string().min(4).max(32),
  name: z.string().max(120).optional(),
  blockedAt: z.string().datetime(),
  reason: z.string().max(200).optional(),
});
export type BlockedPhone = z.infer<typeof BlockedPhoneSchema>;
export const BlockedPhonesSchema = z.array(BlockedPhoneSchema);

export const AdminAuthSchema = z.object({
  passwordHash: z.string(),
  jwtSecret: z.string(),
  createdAt: z.string().datetime(),
  /** Base32 TOTP secret. Absent until owner enables 2FA. */
  totpSecret: z.string().optional(),
  /** When true, TOTP code is required at login. */
  totpEnabled: z.boolean().default(false),
});
export type AdminAuth = z.infer<typeof AdminAuthSchema>;

// ----- Web push (PWA notifications to the salon owner) -----
export const PushSubscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
  createdAt: z.string().datetime(),
});
export type PushSubscription = z.infer<typeof PushSubscriptionSchema>;
export const PushSubscriptionsSchema = z.array(PushSubscriptionSchema);

export const PasswordResetTokenSchema = z.object({
  /** Random URL-safe token (32 bytes hex). Never persisted — kept blank in storage. */
  token: z.string().min(0).max(128),
  /** SHA-256 hash of the token; only the hash is stored, never the raw value. */
  tokenHash: z.string().length(64),
  /** ISO timestamp when the token was issued. */
  issuedAt: z.string().datetime(),
  /** ISO timestamp when the token stops working. */
  expiresAt: z.string().datetime(),
  /** ISO timestamp when consumed; absent if still pending. */
  usedAt: z.string().datetime().optional(),
});
export type PasswordResetToken = z.infer<typeof PasswordResetTokenSchema>;
