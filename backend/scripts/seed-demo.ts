import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";
import { hashPassword } from "../src/lib/password.js";

const email = "demo@aioffice.com";
const password = "12345678";

async function main() {
  const passwordHash = await hashPassword(password);

  await prisma.user.upsert({
    where: { email },
    create: {
      email,
      name: "Demo User",
      passwordHash,
      organization: {
        create: { name: "AI Office Demo" },
      },
    },
    update: {
      name: "Demo User",
      passwordHash,
    },
  });

  const user = await prisma.user.findUnique({
    where: { email },
    include: { organization: true },
  });

  if (user && !user.organization) {
    await prisma.organization.create({
      data: { userId: user.id, name: "AI Office Demo" },
    });
  }

  console.log(`Demo user ready: ${email} / ${password}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
