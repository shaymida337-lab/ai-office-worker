import jwt from "jsonwebtoken";
import { config } from "./src/lib/config.ts";
import { prisma } from "./src/lib/prisma.ts";
import {
  isFinancialReadContainmentActive,
  isFinancialIngestionContainmentActive,
} from "./src/services/p0/financialContainment.ts";

async function main() {
  console.log(
    JSON.stringify({
      read: isFinancialReadContainmentActive(),
      ingestion: isFinancialIngestionContainmentActive(),
    }),
  );

  const org = await prisma.organization.findFirst({
    select: { id: true, userId: true },
  });
  if (!org?.userId) throw new Error(`missing org owner: ${JSON.stringify(org)}`);
  const user = await prisma.user.findUnique({
    where: { id: org.userId },
    select: { id: true, email: true },
  });
  if (!user) throw new Error("missing user for org");
  console.log("auth", { userId: user.id, organizationId: org.id, email: user.email });

  const token = jwt.sign(
    { userId: user.id, organizationId: org.id, email: user.email },
    config.jwtSecret,
    { expiresIn: "1h" },
  );

  async function hit(path: string) {
    const res = await fetch(`http://127.0.0.1:4000/api${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const text = await res.text();
    console.log(JSON.stringify({ path, status: res.status, body: text.slice(0, 700) }));
    return { status: res.status, text };
  }

  await hit("/clients");
  await hit("/invoices/months?completeness=complete");
  await hit("/invoices?completeness=complete&limit=5");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
