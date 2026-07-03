# Dashboard visual QA

## Production smoke (recommended)

From `frontend/`:

```bash
node _visual-qa/dashboard-production-smoke.mjs
```

This script:

1. Deletes `frontend/.next` (avoids stale-cache 500 errors)
2. Runs `npm run build`
3. Starts `npm run start` on **port 3011**
4. Verifies `/dashboard` is healthy (fails fast on HTTP 500 or "Internal Server Error")
5. Runs `dashboard-phase7-compare.mjs` at all breakpoints

## Manual run (server already on 3011)

```bash
# after: rm -rf .next && npm run build && PORT=3011 npm run start
VISUAL_QA_BASE=http://localhost:3011 node _visual-qa/dashboard-phase7-compare.mjs
```

Or skip rebuild in the smoke runner:

```bash
VISUAL_QA_SKIP_BUILD=1 node _visual-qa/dashboard-production-smoke.mjs
```

## Auth

- Default: mock token + API route mocks (`dashboard-auth.mjs`)
- Live: set `VISUAL_QA_EMAIL` + `VISUAL_QA_PASSWORD`, or `VISUAL_QA_TOKEN`

## Do not use

- `next dev` on 3000/3001 for screenshot QA — use production `next start` on **3011** only.
