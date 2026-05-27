# Run locally (verified paths)

Project root: `c:\Users\shaym\ai-office-worker`

```
ai-office-worker/
├── backend/          ← API (port 4000)
├── frontend/         ← Next.js (port 3000)
├── package.json      ← npm workspaces root
└── node_modules/     ← shared dependencies
```

## 1. Install (from project root only)

```powershell
cd c:\Users\shaym\ai-office-worker
npm install
```

## 2. Environment

```powershell
Copy-Item backend\.env.example backend\.env
Copy-Item frontend\.env.example frontend\.env.local
```

Ensure PostgreSQL is running locally and `backend\.env` points to:
`postgresql://postgres:postgres@localhost:5432/ai_office_worker`

## 3. Database

```powershell
npm run db:generate
npm run db:migrate
```

## 4. Start app

```powershell
npm run dev
```

Wait for: `Server running on port 4000` and `Ready` from Next.js.

Open: http://localhost:3000/login

## 5. Test auth

```powershell
# Health
Invoke-RestMethod http://localhost:4000/health

# Register
$body = @{ email = "you@test.com"; password = "password123"; name = "Test" } | ConvertTo-Json
Invoke-RestMethod http://localhost:4000/auth/register -Method POST -ContentType "application/json" -Body $body

# Login
$login = @{ email = "you@test.com"; password = "password123" } | ConvertTo-Json
Invoke-RestMethod http://localhost:4000/auth/login -Method POST -ContentType "application/json" -Body $login
```

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Port 4000 in use | `Stop-Process -Name node -Force` then restart backend |
| `tsx watch` stuck | Use `npm run dev` (no watch) in backend |
| Slow first start | Normal on Windows; wait 10–20s after "Starting API" |
| Frontend cannot reach API | Check `frontend\.env.local` has `NEXT_PUBLIC_API_URL=http://localhost:4000` |
