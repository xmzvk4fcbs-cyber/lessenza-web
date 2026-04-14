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

Full step-by-step guide: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

Short version:
1. Google Cloud service account + share calendar with it
2. Push to GitHub, connect to Netlify
3. Set env vars (see `.env.example`)
4. Visit `/admin/` with `SETUP_TOKEN`, set password, delete `SETUP_TOKEN`
5. Configure tabs, done.

## Testing

```bash
npm test        # run all Vitest suites
npm run build   # tsc --noEmit
npm run lint    # eslint
```

## Project layout

See `docs/superpowers/specs/2026-04-13-booking-system-design.md` for the full system design and `docs/superpowers/plans/` for implementation plans.
