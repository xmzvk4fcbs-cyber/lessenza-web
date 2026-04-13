# L'Essenza Beauty Salon

Static site + booking system for L'Essenza Beauty Salon.

## Stack

- Static HTML/CSS/JS (existing marketing site)
- Netlify Functions (TypeScript, Node 20) for the booking API
- Netlify Blobs for configuration storage
- Google Calendar as the appointment store

## Local development

```bash
nvm use
npm install
npm test
npm run dev   # netlify dev on http://localhost:8888
```

## Deployment

Pushes to `main` auto-deploy to Netlify.

### Required env vars

See `.env.example`. Set them in Netlify Site Settings → Environment variables.

### First-time admin setup

1. In Netlify env vars, set `SETUP_TOKEN` to a long random string (e.g. `openssl rand -hex 24`).
2. Send the token to the owner.
3. She visits `/admin/` and completes the "Prvo pokretanje" form.
4. **Remove `SETUP_TOKEN`** from Netlify env vars.

### Google Calendar setup

1. Create a Google Cloud project.
2. Enable the Google Calendar API.
3. Create a service account; download the JSON key.
4. In the owner's Google Calendar, share the target calendar with the service account's email, with "Make changes to events" permission.
5. `base64 -i key.json` → paste into `GOOGLE_SERVICE_ACCOUNT_JSON`.
6. Set `GOOGLE_CALENDAR_ID` to the owner's calendar id (her email for the primary calendar).

## Project layout

See `docs/superpowers/specs/2026-04-13-booking-system-design.md` for the full system design and `docs/superpowers/plans/` for implementation plans.
