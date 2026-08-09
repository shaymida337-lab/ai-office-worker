import { config as loadEnv } from "dotenv";
import { join } from "path";

loadEnv({ path: join(process.cwd(), ".env") });

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

  const q = "שרית";
  const [leadCount, clientCount, leads, clients, users] = await Promise.all([
    prisma.lead.count(),
    prisma.client.count(),
    prisma.lead.findMany({
      where: {
        OR: [{ name: { contains: q } }, { name: { contains: "שר" } }],
      },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        whatsapp: true,
        organizationId: true,
        stage: true,
      },
      take: 40,
    }),
    prisma.client.findMany({
      where: {
        OR: [{ name: { contains: q } }, { name: { contains: "שר" } }],
      },
      select: {
        id: true,
        name: true,
        email: true,
        whatsappNumber: true,
        organizationId: true,
      },
      take: 40,
    }),
    prisma.user.findMany({
      where: { email: { contains: "shaymida" } },
      select: {
        id: true,
        email: true,
        name: true,
        organization: { select: { id: true, name: true } },
      },
      take: 5,
    }),
  ]);

  // Also check Sharon org specifically
  const orgId = "cmqxujfuj034ndy2czu9tjoko";
  const orgClients = await prisma.client.findMany({
    where: { organizationId: orgId },
    select: { id: true, name: true, email: true, whatsappNumber: true },
    take: 100,
  });
  const orgLeads = await prisma.lead.findMany({
    where: { organizationId: orgId },
    select: { id: true, name: true, phone: true, email: true, whatsapp: true, stage: true },
    take: 100,
  });

  console.log(
    JSON.stringify(
      {
        host,
        leadCount,
        clientCount,
        leads,
        clients,
        users,
        orgClientCount: orgClients.length,
        orgLeadCount: orgLeads.length,
        orgClients,
        orgLeads,
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
