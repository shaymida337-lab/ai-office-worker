# QA Checklist — Onboarding, OAuth Return, Gmail Scan

Manual verification for the first-user journey and dashboard Gmail actions.

## New user onboarding

- [ ] New user logs in and lands on `/onboarding`
- [ ] Connect Gmail from onboarding step 4 → Google consent → returns to `/onboarding` (not dashboard/calendar)
- [ ] Connect Calendar from onboarding step 4 → Google consent → returns to `/onboarding`
- [ ] User can advance to final onboarding success screen (steps 5–6)
- [ ] OAuth failure shows Hebrew error on onboarding and allows retry

## Dashboard — Gmail connect / scan

- [ ] User without Gmail sees connect CTA (`התחבר לג׳ימייל`) on hero and quick actions
- [ ] Clicking connect starts Google OAuth (`/api/integrations/gmail/connect-url` or redirect)
- [ ] After OAuth from dashboard, user returns to `/dashboard?gmail=connected`
- [ ] Connected user sees `סרוק מייל` on hero and quick actions
- [ ] Clicking scan sends `POST /api/gmail/scan` and shows loading / toast
- [ ] Success or useful Hebrew error is shown (no silent failure)
- [ ] `?connect=gmail` after login auto-starts connect flow

## Existing entry points (unchanged behavior)

- [ ] Settings Gmail connect returns to `/dashboard/settings?gmail=connected`
- [ ] Calendar connect returns to `/dashboard/calendar?calendar=connected`

## Console / Network

- [ ] No React error #418 / hydration mismatch on `/dashboard` and `/onboarding`
- [ ] CTA click creates Network request or OAuth navigation
- [ ] Backend logs: `[gmail/connect-url] returnTo=...`, `[gmail/callback] redirect returnTo=...`, `[dashboard] gmail scan clicked`

## Automated

```bash
npm run build -w backend
npm run build -w frontend
node --import tsx --test backend/src/lib/oauthReturn.test.ts
```
