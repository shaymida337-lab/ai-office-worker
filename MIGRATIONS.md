# Database Migrations

## Production Rule

All schema changes must go through Prisma migrations. Do not edit the production database directly with raw SQL for schema changes.

Direct production SQL caused the previous stuck-migration incident: tables and columns existed in PostgreSQL, but Prisma migration history did not know they were applied. That made every deploy try to re-apply old migrations.

## Normal Development Flow

1. Change `backend/prisma/schema.prisma`.
2. Generate a migration locally:

   ```bash
   cd backend
   npx prisma migrate dev --name <short_description>
   ```

3. Review the generated SQL in `backend/prisma/migrations/.../migration.sql`.
4. Run local build/tests.
5. Commit `schema.prisma` and the migration folder together.
6. Push and deploy the application code.

## Production Migration Flow

Migrations run automatically on deploy via `preDeployCommand`. Manual `prisma migrate deploy` remains available for emergencies.

The backend service runs this after build and before start:

```bash
cd backend
npx prisma migrate deploy
```

For emergency manual runs, use the Render Shell for the backend service, where `DATABASE_URL` points to the production database.

## Drift Check

To check whether `schema.prisma` matches the connected database:

```bash
cd backend
npm run db:check-drift
```

Expected healthy output is an empty migration / no SQL changes. If SQL is printed, do not apply it blindly. Review the drift first.

## If A Migration Gets Stuck

Do not reset the production database. Do not drop customer tables. Do not use `db push --accept-data-loss`.

Use read-only checks first:

```bash
cd backend
npx prisma migrate status
```

Inspect `_prisma_migrations` and the actual database objects with read-only `SELECT` queries. Then choose the safest recovery:

- If the migration's tables, columns, indexes, and constraints already exist and match the migration SQL, mark it applied:

  ```bash
  npx prisma migrate resolve --applied <migration_name>
  ```

- If the migration did not apply and its objects do not exist, mark it rolled back, then deploy migrations again:

  ```bash
  npx prisma migrate resolve --rolled-back <migration_name>
  npx prisma migrate deploy
  ```

- If it partially applied, stop and inspect manually. Repair only the missing objects with a reviewed migration or reviewed SQL, then resolve the migration state.

## Staging Recommendation

Add a separate Render staging environment before making future schema changes:

1. Create a staging PostgreSQL database in Render.
2. Create a staging backend service connected to that staging database.
3. Create a staging frontend service pointing `NEXT_PUBLIC_API_URL` at the staging backend.
4. Use separate environment variables and OAuth callback URLs for staging.
5. Before production, deploy the branch to staging, run:

   ```bash
   cd backend
   npx prisma migrate deploy
   npm run db:check-drift
   ```

6. Smoke test Gmail/WhatsApp/Drive flows in staging.
7. Only then apply the same migration to production manually.

