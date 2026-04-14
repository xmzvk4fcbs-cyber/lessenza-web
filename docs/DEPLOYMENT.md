# Deploying L'Essenza to Netlify

A one-time guide to take this repo from "on a laptop" to "live site at lessenza.netlify.app".

## 1. Google Cloud: service account for Calendar

1. Go to https://console.cloud.google.com/ and create a new project (e.g. `lessenza-booking`).
2. Enable the **Google Calendar API** (APIs & Services → Library).
3. Create a service account: IAM & Admin → Service Accounts → Create.
   - Name: `lessenza-booking`
   - Role: none needed at the project level.
4. Create a JSON key: click the account → Keys → Add key → JSON. Download the file.
5. Base64-encode the key so it fits in an env var:
   ```bash
   base64 -i lessenza-booking.json | pbcopy   # macOS, copies to clipboard
   ```
   On Linux: `base64 -w0 lessenza-booking.json`.

## 2. Google Calendar: share with the service account

1. Open https://calendar.google.com as the owner.
2. Create (or pick) a calendar dedicated to the salon (e.g. `L'Essenza`).
3. Open Settings of that calendar → "Share with specific people or groups" → Add people.
4. Add the service account email (ends with `…iam.gserviceaccount.com`). Give it **"Make changes to events"**.
5. Copy the "Calendar ID" from Settings → "Integrate calendar".

## 3. GitHub repo

1. Create a new empty private repo on GitHub (e.g. `lessenza`).
2. From the local project:
   ```bash
   git remote add origin git@github.com:<you>/lessenza.git
   git push -u origin main
   ```

## 4. Netlify site

1. Netlify → Add new site → Import from Git → pick the GitHub repo.
2. Build settings: auto-detected from `netlify.toml`. No overrides needed.
3. After the first build, go to Site → Configuration → Environment variables and add:

   | Key | Value |
   | --- | --- |
   | `GOOGLE_SERVICE_ACCOUNT_JSON` | Base64 string from step 1.5 |
   | `GOOGLE_CALENDAR_ID` | The calendar ID from step 2.5 |
   | `SETUP_TOKEN` | A long random string (e.g. `openssl rand -hex 24`) — used once |
   | `SITE_URL` | `https://<your-site>.netlify.app` |
   | `RESEND_API_KEY` | From https://resend.com (free tier) |
   | `RESEND_FROM` | `L'Essenza <onboarding@resend.dev>` (or your verified sender) |

   Gmail alternative (instead of Resend):

   | Key | Value |
   | --- | --- |
   | `GMAIL_USER` | Owner's Gmail address |
   | `GMAIL_APP_PASSWORD` | 16-char app password from https://myaccount.google.com/apppasswords |

4. Trigger a re-deploy (Site → Deploys → Trigger deploy).

## 5. First-run admin setup

1. Visit `https://<your-site>.netlify.app/admin/`.
2. On the "Prvo pokretanje" screen, paste the `SETUP_TOKEN` value and pick a password ≥ 8 chars.
3. After confirmation, **go back to Netlify and DELETE the `SETUP_TOKEN` env var**. Leaving it set would let an attacker reset the admin if the Blob gets cleared.
4. You'll land on the admin home. Configure each tab (Radno vrijeme, Usluge, Paralelni parovi, Podešavanja).

## 6. Owner's iPhone setup

1. Settings → Calendar → Accounts → Add Account → Google. Sign in with the owner's Google account.
2. Turn on "Calendars" for the Google account. The shared "L'Essenza" calendar will appear in the iOS Calendar app.
3. Bookings will surface as normal iOS Calendar events with native notifications.

## 7. Cron schedules

These are already configured in `netlify.toml`:
- `cron-daily-digest` runs at 18:00 UTC (= 20:00 summer / 19:00 winter Europe/Podgorica)
- `cron-reminder` runs hourly

Verify at Netlify Site → Functions. If your plan doesn't include scheduled functions (free tier does), upgrade or disable both via the admin "Podešavanja" tab.

## 8. Smoke test

From an iPhone, visit:
- `https://<your-site>.netlify.app/zakazivanje.html` — book a test appointment (use your own email).
- Check: confirmation email arrives, appointment appears in the owner's iOS Calendar within ~1 minute.
- Admin `/admin/` → **Danas** tab shows it. Try cancelling and verify the cancellation email arrives.

## Troubleshooting

- **Bookings return 500:** service account doesn't have access to the calendar or `GOOGLE_CALENDAR_ID` is wrong.
- **Admin login loops:** Blobs not available in region; ensure site is deployed in a supported region.
- **Emails never arrive:** `RESEND_API_KEY` missing or the `from` address isn't verified. Confirm in Resend dashboard.
- **Client sees slot as "taken" that you cleared in calendar:** deleted events may linger for ~1 min in the Google Calendar API cache. Refresh after a minute.
