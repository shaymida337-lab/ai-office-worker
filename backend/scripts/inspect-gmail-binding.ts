/**
 * inspect-gmail-binding.ts — תצפית read-only על קשירות Gmail (token_already_bound).
 *
 * מדפיס שלוש טבלאות: כל הארגונים / כל אינטגרציות ה-Gmail (בלי טוקנים —
 * רק האם קיימים) / שיוך הארגון של המשתמש הפעיל.
 *
 * קריאה בלבד — אין שום כתיבה. מיועד להרצה ידנית ב-Render Shell:
 *   npx tsx scripts/inspect-gmail-binding.ts [--email user@example.com]
 */
import { PrismaClient } from "@prisma/client";

function argValue(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : null;
}
const userEmail = (argValue("--email") ?? "shaymida337@gmail.com").trim().toLowerCase();

const prisma = new PrismaClient();

function metadataEmail(metadata: string | null): string | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata) as { googleAccountEmail?: unknown };
    return typeof parsed.googleAccountEmail === "string" ? parsed.googleAccountEmail.toLowerCase() : null;
  } catch {
    return null;
  }
}

async function main() {
  console.log(`inspect-gmail-binding | ${new Date().toISOString()} | READ-ONLY | user=${userEmail}\n`);

  const organizations = await prisma.organization.findMany({
    select: { id: true, name: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  console.log("=== 1. ארגונים ===");
  console.table(
    organizations.map((org) => ({
      id: org.id,
      name: org.name,
      createdAt: org.createdAt.toISOString().slice(0, 10),
    }))
  );

  const integrations = await prisma.integration.findMany({
    where: { provider: "gmail" },
    select: { organizationId: true, metadata: true, connectedAt: true, updatedAt: true, refreshToken: true, accessToken: true },
    orderBy: { connectedAt: "asc" },
  });
  const orgName = new Map(organizations.map((org) => [org.id, org.name]));
  console.log("=== 2. אינטגרציות Gmail ===");
  console.table(
    integrations.map((integration) => ({
      organizationId: integration.organizationId,
      orgName: orgName.get(integration.organizationId) ?? "?",
      accountEmail: metadataEmail(integration.metadata) ?? "-",
      hasRefreshToken: Boolean(integration.refreshToken),
      hasAccessToken: Boolean(integration.accessToken),
      connectedAt: integration.connectedAt.toISOString(),
      updatedAt: integration.updatedAt.toISOString(),
    }))
  );

  const user = await prisma.user.findFirst({
    where: { email: { equals: userEmail, mode: "insensitive" } },
    select: {
      id: true,
      email: true,
      organizationMemberships: {
        select: { organizationId: true, role: true, organization: { select: { name: true } } },
      },
    },
  });
  console.log("=== 3. המשתמש הפעיל ===");
  if (!user) {
    console.log(`(לא נמצא משתמש עם המייל ${userEmail})`);
  } else {
    console.table(
      user.organizationMemberships.map((membership) => ({
        userId: user.id,
        email: user.email,
        organizationId: membership.organizationId,
        orgName: membership.organization.name,
        role: membership.role,
      }))
    );
  }

  console.log("\nהצלבה: הארגון החוסם הוא זה שמופיע בטבלה 2 עם accountEmail זהה,");
  console.log("hasRefreshToken=true, ו-organizationId שונה מהארגון של המשתמש בטבלה 3.");
}

main()
  .catch((err) => {
    console.error("inspect-gmail-binding failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
