import { config } from "dotenv";
import { join } from "path";
import { PrismaClient } from "@prisma/client";

config({ path: join(process.cwd(), ".env.prod.local") });
const prisma = new PrismaClient({ datasources: { db: { url: process.env.PROD_DATABASE_URL } } });

const invoices = await prisma.invoice.findMany({
  where: { supplierName: { contains: "normalizeDetected" } },
  select: { organizationId: true, supplierName: true },
  take: 5,
});
const payments = await prisma.supplierPayment.findMany({
  where: {
    OR: [
      { supplierName: { contains: "normalizeDetected" } },
      { supplier: { contains: "normalizeDetected" } },
    ],
  },
  select: { organizationId: true, supplierName: true, supplier: true },
  take: 5,
});
const paren = await prisma.invoice.findMany({
  where: { supplierName: { contains: "(" } },
  select: { organizationId: true, supplierName: true },
  take: 10,
});

console.log(JSON.stringify({ invoices, payments, parenInvoices: paren }, null, 2));
await prisma.$disconnect();
