require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  let user = await prisma.user.findFirst();
  if (!user) {
    user = await prisma.user.create({ data: { email: 'demo@local', googleId: `demo-${Date.now()}`, displayName: 'Demo User' } });
    console.log('Created demo user', user.id);
  } else {
    console.log('Using existing user', user.id);
  }

  const doc = await prisma.document.create({
    data: {
      userId: user.id,
      gmailMessageId: `seed-${Date.now()}`,
      emailSubject: 'Demo Invoice INV-999',
      emailSender: 'Demo Supplier',
      emailSenderAddr: 'supplier@demo',
      receivedAt: new Date(),
      vendorName: 'Demo Supplier',
      docType: 'INVOICE',
      invoiceNumber: 'INV-999',
      docDate: new Date('2026-05-01'),
      paymentDueDate: new Date('2026-05-30'),
      amountPreTax: 3450,
      taxAmount: 0,
      totalAmount: 3450,
      currency: 'ILS',
      status: 'NEW',
      requiresAction: false,
      aiConfidence: 0.99,
    }
  });

  const hash = require('crypto').createHash('sha256').update(`${doc.vendorName}|${doc.invoiceNumber}|${doc.totalAmount}`).digest('hex');
  const payment = await prisma.supplierPayment.create({
    data: {
      userId: user.id,
      supplierName: doc.vendorName,
      amount: doc.totalAmount,
      currency: doc.currency,
      date: doc.docDate,
      dueDate: doc.paymentDueDate,
      paid: false,
      documentId: doc.id,
      invoiceLink: doc.driveFileUrl || null,
      invoiceHash: hash,
    }
  });

  console.log('Seeded document and payment', doc.id, payment.id);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => process.exit(0));
