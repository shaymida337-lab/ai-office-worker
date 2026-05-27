# AI Office Worker — SaaS

עוזר משרד AI לעסקים בישראל: Gmail, חשבוניות, Google Drive, לוח בקרה ו-WhatsApp.

## Stack

| Layer | Tech |
|-------|------|
| Frontend | Next.js |
| Backend | Node.js + Express |
| Database | Prisma + PostgreSQL |
| AI | Claude API |
| Messaging | Twilio WhatsApp |
| Integrations | Gmail, Google Drive, Google Sheets |

## Quick start

```bash
npm install
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
npm run db:generate
npm run db:migrate
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

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
| `npm run db:migrate` | Apply Prisma migrations |

## Region defaults

Israel · Hebrew · ILS · Asia/Jerusalem
