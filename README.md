# AI Office Worker — SaaS

עוזר משרד AI לעסקים בישראל: Gmail, חשבוניות, Google Drive, לוח בקרה ו-WhatsApp.

## Stack

| Layer | Tech |
|-------|------|
| Frontend | Next.js (Netlify) |
| Backend | Node.js + Express (Railway) |
| Database | Prisma + SQLite (dev) → PostgreSQL (prod) |
| AI | Claude API |
| Messaging | Twilio WhatsApp |
| Integrations | Gmail, Google Drive, Google Sheets |

## Quick start

```bash
npm install
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
cd backend && npx prisma db push && cd ..
npm run dev -w backend
npm run dev -w frontend
```

Open [http://localhost:3000](http://localhost:3000) → Sign in with Google.

**Full beginner guide:** [docs/BEGINNER-SETUP-SAAS.md](./docs/BEGINNER-SETUP-SAAS.md)  
**Roadmap:** [ROADMAP-SAAS.md](./ROADMAP-SAAS.md)

## Project structure

```
backend/     API, Prisma, Gmail sync, Claude, Twilio, cron worker
frontend/    Hebrew RTL dashboard
docs/        Setup guides
legacy/      Original Make.com MVP files (reference only)
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | API + frontend together |
| `npm run worker -w backend` | Scheduled Gmail + WhatsApp jobs |
| `npm run db:push -w backend` | Apply Prisma schema |

## Region defaults

Israel · Hebrew · ILS · Asia/Jerusalem
