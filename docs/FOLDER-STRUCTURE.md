# Folder structure

```
ai-office-worker/
├── package.json                 # npm workspaces root
├── README.md
├── ROADMAP-SAAS.md              # Product roadmap (SaaS)
├── railway.toml                 # Railway API deploy hint
│
├── backend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── .env.example
│   ├── prisma/
│   │   └── schema.prisma        # Database schema (SQLite)
│   └── src/
│       ├── index.ts             # Express API entry
│       ├── worker.ts            # Cron: Gmail + WhatsApp
│       ├── lib/
│       │   ├── prisma.ts
│       │   ├── config.ts
│       │   ├── auth.ts          # JWT middleware
│       │   └── duplicate.ts     # Invoice dedup hash
│       ├── routes/
│       │   ├── auth.ts          # Google OAuth
│       │   ├── api.ts           # Dashboard, payments, tasks
│       │   ├── cron.ts          # External cron hooks
│       │   └── webhooks.ts      # Twilio WhatsApp
│       └── services/
│           ├── claude.ts        # Email AI extraction
│           ├── google.ts        # OAuth clients, Drive folders
│           ├── gmail-sync.ts    # Core Gmail pipeline
│           ├── dashboard.ts     # KPI aggregates
│           ├── summary.ts       # Daily summaries + alerts
│           └── whatsapp.ts      # Twilio send + commands
│
├── frontend/
│   ├── package.json
│   ├── next.config.ts
│   ├── netlify.toml
│   ├── .env.example
│   └── src/
│       ├── app/
│       │   ├── page.tsx         # Landing + Google login
│       │   ├── dashboard/       # KPIs + Gmail sync
│       │   ├── payments/        # Supplier table
│       │   ├── tasks/
│       │   ├── reports/         # Missing invoices
│       │   └── auth/callback/
│       ├── components/
│       │   └── Nav.tsx
│       └── lib/
│           └── api.ts           # API client
│
├── docs/
│   ├── BEGINNER-SETUP-SAAS.md
│   └── FOLDER-STRUCTURE.md
│
└── legacy/                      # Old Make.com MVP (reference)
    ├── templates/
    ├── make/
    └── docs/
```
