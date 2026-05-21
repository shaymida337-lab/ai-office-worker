const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  const users = await p.user.findMany();
  console.log('users', users.length);
  const docs = await p.document.findMany({ take: 5 });
  console.log('documents', docs.length, docs.map(x => x.id));
  const payments = await p.supplierPayment.findMany({ take: 5 });
  console.log('payments', payments.length, payments.map(x => x.id));
  await p.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
