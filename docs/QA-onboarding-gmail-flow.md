# QA Checklist — First 5 Minutes (Onboarding → Dashboard → First Scan)

## Signup & entry

- [ ] New user signs up at `/signup` → lands on `/onboarding` (not `/dashboard` first)
- [ ] Returning user login without `next` → `/dashboard`
- [ ] JWT stored in `localStorage.token`

## Onboarding conversation

- [ ] Steps 1–4 progress persists across refresh (`natalie.onboarding.progress`)
- [ ] Gmail connect from step 4 → Google → returns to `/onboarding` with connected state
- [ ] Calendar connect (optional) → returns to `/onboarding`
- [ ] OAuth cancel shows Hebrew retry message on onboarding
- [ ] WhatsApp button does **not** leave onboarding (shows info message only)
- [ ] Step 5 save completes → exit animation → **automatic** `/dashboard?firstVisit=1`
- [ ] User is **never** sent to `/message-scans`, `/calendar`, or `/settings` from onboarding

## First dashboard visit

- [ ] Natalie welcome: "מושלם. הכול מוכן..."
- [ ] If Gmail connected: first scan starts automatically (Network: `POST /api/gmail/scan`)
- [ ] If Gmail not connected: single obvious CTA "התחבר לג׳ימייל"
- [ ] Quick actions / conversation examples hidden until first scan settles
- [ ] Scan progress visible (banner + hero message phases)
- [ ] Zero results: clear Hebrew explanation (not silent empty state)
- [ ] Scan error: toast with Hebrew message

## Regression

- [ ] Settings Gmail connect still returns to `/dashboard/settings?gmail=connected`
- [ ] Calendar page connect still returns to `/dashboard/calendar?calendar=connected`
- [ ] No React #418 on `/onboarding` and `/dashboard`
- [ ] CTA clicks always produce Network request or OAuth navigation

## Automated

```bash
npm run build -w backend
npm run build -w frontend
node --import tsx --test backend/src/lib/oauthReturn.test.ts
node --import tsx --test frontend/src/lib/natalie/firstDay.test.ts
node --import tsx --test frontend/src/lib/dashboard/home.test.ts
```
