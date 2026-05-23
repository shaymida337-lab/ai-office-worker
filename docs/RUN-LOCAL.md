# Run locally (verified paths)

Project root: `c:\Users\User\Documents\ai-office-worker`

```
ai-office-worker/
├── backend/          ← API (port 4000)
├── frontend/         ← Next.js (port 3000)
├── package.json      ← npm workspaces root
└── node_modules/     ← shared dependencies
```

## 1. Install (from project root only)

```powershell
cd c:\Users\User\Documents\ai-office-worker
npm install
```

## 2. Database (from backend folder)

```powershell
cd c:\Users\User\Documents\ai-office-worker\backend
npx prisma db push
npx prisma generate
```

Ensure `backend\.env` exists (copy from `backend\.env.example`).

## 3. Start backend (Terminal 1)

```powershell
cd c:\Users\User\Documents\ai-office-worker\backend
npm run dev
```

Wait for: `API running on http://localhost:4000`

## 4. Start frontend (Terminal 2)

```powershell
cd c:\Users\User\Documents\ai-office-worker\frontend
npm run dev
```

Open: http://localhost:3000/login

## 5. Test auth (Terminal 3)

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
