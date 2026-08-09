import { PrismaClient } from "@prisma/client";

const prodUrl = process.env.PROD_DATABASE_URL;
if (!prodUrl) throw new Error("PROD_DATABASE_URL missing");
const u = new URL(prodUrl);
u.searchParams.set("pgbouncer", "true");
const p = new PrismaClient({ datasources: { db: { url: u.toString() } } });
const org = "cmpjd7j7e0001bl5tzv049rxb";

const lastNonZero = await p.syncLog.findFirst({
  where: {
    organizationId: org,
    OR: [{ emailsProcessed: { gt: 0 } }, { totalMatched: { gt: 0 } }, { invoicesFound: { gt: 0 } }],
  },
  orderBy: { startedAt: "desc" },
});

const lastError = await p.syncLog.findFirst({
  where: { organizationId: org, OR: [{ status: "error" }, { status: "failed" }, { errorsCount: { gt: 0 } }] },
  orderBy: { startedAt: "desc" },
});

console.log(
  JSON.stringify(
    {
      lastNonZero: lastNonZero && {
        id: lastNonZero.id,
        status: lastNonZero.status,
        emailsProcessed: lastNonZero.emailsProcessed,
        emailsSaved: lastNonZero.emailsSaved,
        totalMatched: lastNonZero.totalMatched,
        invoicesFound: lastNonZero.invoicesFound,
        startedAt: lastNonZero.startedAt,
        finishedAt: lastNonZero.finishedAt,
        errorMessage: lastNonZero.errorMessage,
        scanMode: lastNonZero.scanMode,
      },
      lastError: lastError && {
        id: lastError.id,
        status: lastError.status,
        errorsCount: lastError.errorsCount,
        errorMessage: lastError.errorMessage,
        startedAt: lastError.startedAt,
        finishedAt: lastError.finishedAt,
      },
    },
    null,
    2
  )
);
await p.$disconnect();
