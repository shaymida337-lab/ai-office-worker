import { spawn } from "node:child_process";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required to check Prisma drift.");
  process.exit(1);
}

const child = spawn(
  "npx",
  [
    "prisma",
    "migrate",
    "diff",
    "--from-url",
    process.env.DATABASE_URL,
    "--to-schema-datamodel",
    "prisma/schema.prisma",
    "--script",
  ],
  { stdio: "inherit", shell: true }
);

child.on("close", (code) => {
  process.exit(code ?? 1);
});
