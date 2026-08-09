import { config as loadEnv } from "dotenv";
import { existsSync } from "fs";
import { join } from "path";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: true });
}

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const url = process.env.PROD_DATABASE_URL || process.env.DATABASE_URL || "";
  let host = "unknown";
  try {
    host = new URL(url).host;
  } catch {
    host = "parse-failed";
  }

  const [leadCount, clientCount, users] = await Promise.all([
    prisma.lead.count(),
    prisma.client.count(),
    prisma.user.findMany({
      select: { email: true, name: true, id: true },
      take: 20,
    }),
  ]);

  const named = await prisma.client.findMany({
    where: {
      OR: [
        { name: { contains: "שר" } },
        { name: { contains: "sarit", mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, organizationId: true },
    take: 50,
  });

  const namedLeads = await prisma.lead.findMany({
    where: {
      OR: [
        { name: { contains: "שר" } },
        { name: { contains: "sarit", mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, organizationId: true, phone: true, whatsapp: true },
    take: 50,
  });

  const sampleClients = await prisma.client.findMany({
    select: { id: true, name: true, organizationId: true },
    take: 30,
    orderBy: { updatedAt: "desc" },
  });

  const sampleLeads = await prisma.lead.findMany({
    select: { id: true, name: true, organizationId: true },
    take: 30,
    orderBy: { updatedAt: "desc" },
  });

  console.log(
    JSON.stringify(
      {
        dbHost: host,
        usingProdOverride: Boolean(process.env.PROD_DATABASE_URL),
        leadCount,
        clientCount,
        users,
        named,
        namedLeads,
        sampleClients,
        sampleLeads,
      },
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
