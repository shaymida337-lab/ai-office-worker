// הרצה חד-פעמית מקומית: seed org+user+membership והדפסת JWT לבדיקה.
import { PrismaClient } from "@prisma/client";
import { signToken } from "../src/lib/auth.js";

async function main() {
  const prisma = new PrismaClient();
  const user = await prisma.user.upsert({
    where: { email: process.env.SEED_EMAIL ?? "owner@test.local" },
    update: {},
    create: { email: process.env.SEED_EMAIL ?? "owner@test.local", name: "Owner" },
  });
  const org = await prisma.organization.upsert({
    where: { userId: user.id },
    update: {},
    create: { userId: user.id, name: "Test Biz" },
  });
  await prisma.organizationMember.upsert({
    where: { organizationId_userId: { organizationId: org.id, userId: user.id } },
    update: { role: "owner" },
    create: { organizationId: org.id, userId: user.id, role: "owner" },
  });
  console.log(JSON.stringify({
    token: signToken({ userId: user.id, organizationId: org.id, email: user.email }),
    organizationId: org.id,
  }));
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
