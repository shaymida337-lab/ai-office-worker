require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

const prisma = new PrismaClient();

const hashPassword = (password) => {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
};

async function main() {
  const email = 'shaymida337@gmail.com';
  const password = '123456';

  const normalized = email.toLowerCase().trim();
  const deleted = await prisma.user.deleteMany({ where: { email: normalized } });
  if (deleted.count > 0) {
    console.log('Deleted existing user entries:', deleted.count);
  }

  const user = await prisma.user.create({
    data: {
      email: normalized,
      passwordHash: hashPassword(password),
      displayName: 'Shay',
      isActive: true,
    },
  });

  console.log('Created fresh user', user.id);
  console.log('Done. You can now log in with:', email, password);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => process.exit(0));
