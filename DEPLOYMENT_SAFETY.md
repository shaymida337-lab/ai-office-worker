# Deployment Safety

This document explains how to avoid and recover from frontend/backend deploy mismatches on Render.

## Root cause we hit (July 2026)

Backend deploys failed at **pre_deploy** with `prisma migrate deploy` when using Neon's **connection pooler** URL. Prisma needs a direct Postgres connection for migration advisory locks.

**Fix in `render.yaml`:** pre-deploy strips `-pooler` from `DATABASE_URL` and sets `PRISMA_MIGRATE_ADVISORY_LOCK_TIMEOUT=60000`.

## Before pushing to `main`

Run from repo root:

```bash
npm ci
npm run db:generate -w backend
npm run build -w backend
npm run build -w frontend
npx tsx --test backend/src/lib/buildInfo.test.ts frontend/src/lib/systemDeployStatus.test.ts
```

Or:

```bash
npm run deploy:check
```

CI runs the same checks in `.github/workflows/deploy-safety.yml`.

## Check deploy status on Render

1. Open [Render Dashboard](https://dashboard.render.com) → services:
   - `ai-office-worker-backend`
   - `ai-office-worker-frontend`
2. Latest deploy must be **Live** (not `pre_deploy_failed` or `build_failed`).
3. Note deploy IDs and commit SHAs for both services.

## Verify commit alignment

### Backend (public, no auth)

```bash
curl -s https://ai-office-worker-backend.onrender.com/health
```

Expected fields:

- `status`: `"ok"`
- `database`: `"connected"`
- `commit`: full or short git SHA of the running backend

### Frontend

The dashboard build embeds `NEXT_PUBLIC_APP_COMMIT` from `RENDER_GIT_COMMIT` at build time.

In the app:

- Healthy: no amber banner; system status **"המערכת תקינה"** when checks pass.
- Mismatch / backend down: **"יש עדכון מערכת שלא הושלם — אנחנו מטפלים בזה"** instead of generic timeout text.

### Quick alignment rule

First 7 characters of `commit` in `/health` should match frontend `NEXT_PUBLIC_APP_COMMIT` (visible in browser devtools → `process.env` only at build; compare Render deploy commit list for both services).

## When backend failed but frontend deployed

Symptoms:

- Frontend shows deploy banner or API errors about incomplete system update
- `/health` returns non-200 or old `commit`
- Render backend latest deploy is **Failed**

**Do:**

1. Read backend deploy logs → find the **first** error (ignore cascades).
2. Fix minimally; do not hide errors in UI only.
3. Run `npm run deploy:check` locally.
4. Push fix to `main`.
5. Wait for backend deploy **Live**.
6. Re-check `/health` commit matches frontend deploy commit.

**Do not:**

- Run manual SQL schema changes without a Prisma migration.
- Reset production database.
- Assume frontend "Deployed" means backend is live.

## Emergency manual migration

Only if pre-deploy is blocked and you understand the drift:

```bash
cd backend
# Use DIRECT_URL (non-pooler) — see render.yaml preDeployCommand
DATABASE_URL="$DIRECT_URL" npx prisma migrate deploy
```

Then trigger a backend redeploy on Render.

## Health endpoints

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `GET /health` | No | Liveness + DB + `commit` + `version` |
| `GET /api/health` | No | Same as `/health` |
| `GET /api/system/health` | Yes | Org-scoped subsystem checks |

## Related files

- `render.yaml` — build / preDeploy / start commands
- `MIGRATIONS.md` — Prisma migration workflow
- `.github/workflows/deploy-safety.yml` — CI gate on `main`
