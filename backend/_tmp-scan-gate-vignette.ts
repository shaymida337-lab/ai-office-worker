import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import { config } from "./src/lib/config.ts";

async function main() {
  const prisma = new PrismaClient();
  const user = await prisma.user.findFirst({
    select: {
      id: true,
      email: true,
      organization: { select: { id: true } },
      organizationMemberships: { select: { organizationId: true }, take: 1 },
    },
    orderBy: { createdAt: "asc" },
  });
  const organizationId = user?.organization?.id ?? user?.organizationMemberships[0]?.organizationId;
  if (!user || !organizationId) throw new Error("no local user/org");

  const token = jwt.sign(
    { userId: user.id, organizationId, email: user.email },
    config.jwtSecret,
    { expiresIn: "30m" }
  );
  const headers = { Authorization: `Bearer ${token}`, "Cache-Control": "no-cache" };

  async function hit(path: string) {
    const res = await fetch(`http://127.0.0.1:4000/api${path}`, { headers });
    const text = await res.text();
    return { path, status: res.status, ok: res.ok, sample: text.slice(0, 160) };
  }

  const checks = [
    await hit("/gmail/scan-stats"),
    await hit("/document-reviews?status=needs_review&limit=5"),
    await hit("/debug/gmail/status"),
  ];
  for (const c of checks) console.log(JSON.stringify(c));

  const health = await fetch("http://127.0.0.1:4000/health");
  console.log(JSON.stringify({ path: "/health", status: health.status, ok: health.ok }));

  const failed = checks.filter((c) => !c.ok);
  if (failed.length) {
    console.error("SCAN_GATE_FAILED", failed.map((f) => f.path));
    process.exit(1);
  }
  console.log("SCAN_GATE_OK");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
