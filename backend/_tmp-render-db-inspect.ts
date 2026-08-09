import { config as loadEnv } from "dotenv";
import { join } from "path";

loadEnv({ path: join(process.cwd(), ".env.render-db.tmp"), override: true });

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const url = process.env.DATABASE_URL || "";
  let host = "unknown";
  try {
    host = new URL(url).host;
  } catch {
    host = "parse-failed";
  }

  const totals = {
    host,
    users: await prisma.user.count(),
    orgs: await prisma.organization.count(),
    clients: await prisma.client.count(),
    leads: await prisma.lead.count(),
  };

  const users = await prisma.user.findMany({
    where: {
      OR: [
        { email: { contains: "shaymida" } },
        { email: { contains: "shaykedma" } },
      ],
    },
    select: {
      id: true,
      email: true,
      name: true,
      organization: { select: { id: true, name: true } },
    },
    take: 20,
  });

  const namedClients = await prisma.$queryRawUnsafe<
    Array<{ id: string; name: string; organizationId: string }>
  >(`SELECT id, name, "organizationId" FROM "Client" WHERE name ILIKE '%שר%' OR name ILIKE '%sarit%' LIMIT 50`);

  const namedLeads = await prisma.$queryRawUnsafe<
    Array<{ id: string; name: string; organizationId: string }>
  >(`SELECT id, name, "organizationId" FROM "Lead" WHERE name ILIKE '%שר%' OR name ILIKE '%sarit%' LIMIT 50`);

  const allClientNames = await prisma.client.findMany({
    select: { id: true, name: true, organizationId: true },
    take: 50,
  });

  const allLeadNames = await prisma.lead.findMany({
    select: { id: true, name: true, organizationId: true },
    take: 50,
  });

  console.log(
    JSON.stringify(
      { totals, users, namedClients, namedLeads, allClientNames, allLeadNames },
      null,
      2
    )
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
