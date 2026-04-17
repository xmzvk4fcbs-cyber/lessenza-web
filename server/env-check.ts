/* eslint-disable no-console */
// Fail fast on boot if any required env var is missing. Optional ones print a warning.

interface VarSpec {
  name: string;
  required: boolean;
  why: string;
}

const VARS: VarSpec[] = [
  { name: "JWT_SECRET", required: true, why: "signs admin session cookie" },
  { name: "SITE_URL", required: true, why: "used in email links and OAuth redirect" },
  { name: "LESSENZA_DB_PATH", required: false, why: "overrides ./data/lessenza.db" },
  { name: "PORT", required: false, why: "defaults to 3000" },
  { name: "HOST", required: false, why: "defaults to 127.0.0.1 (behind nginx)" },
  { name: "ADMIN_PASSWORD_HASH", required: false, why: "optional bootstrap; Blobs record overrides" },
  { name: "RESEND_API_KEY", required: false, why: "fallback mailer when Google OAuth not connected" },
  { name: "GMAIL_USER", required: false, why: "SMTP fallback, only if used" },
  { name: "GMAIL_APP_PASSWORD", required: false, why: "SMTP fallback, only if used" },
];

const missing: string[] = [];
for (const v of VARS) {
  if (v.required && !(process.env[v.name] && process.env[v.name]!.trim())) {
    missing.push(`  ${v.name} — ${v.why}`);
  }
}
if (missing.length) {
  console.error("[env] missing required vars:\n" + missing.join("\n"));
  console.error("Set them in .env (loaded via `node --env-file=.env`) or in the systemd unit.");
  process.exit(1);
}

if (!process.env.SELF_HOSTED) process.env.SELF_HOSTED = "1";
if (!process.env.NODE_ENV) process.env.NODE_ENV = "production";
