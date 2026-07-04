/**
 * fix-gmail-connection.ts — פתרון מלא ל-token_already_bound בסבב אחד.
 *
 * מה הסקריפט עושה:
 * 1. מזהה לאילו ארגונים המשתמש שייך בפועל (User + OrganizationMember) ומתריע
 *    אם --target-org אינו אחד מהם (במקרה כזה החיבור ייקשר לארגון שבטוקן
 *    ההתחברות של המשתמש — לא ליעד!).
 * 2. מסמלץ את שני שערי הבידוד עם *אותן פונקציות* שהשרת מריץ
 *    (collectMailboxConflicts / collectRefreshTokenConflicts) ומזהה כל
 *    רשומה חוסמת: התאמת אימייל, וגם רשומות legacy עם accountEmail ריק
 *    שמחזיקות את אותו refresh token (מזוהות ע"י השוואת hash מול הטוקן
 *    שכבר שמור בארגון היעד, אם קיים).
 * 3. מוחק את החוסמות (זהה ל-DELETE /integrations/gmail הרשמי) ומדפיס
 *    פסק-דין סופי: האם חיבור של --email ל---target-org יעבור עכשיו.
 *
 * ⚠️ dry-run כברירת מחדל. מחיקה בפועל: --apply.
 * רשומת legacy ריקה שלא הוכחה כחוסמת (אין טוקן ייחוס להשוואה) לא נמחקת
 * אלא עם --include-unproven-legacy.
 *
 * הרצה (Render Shell):
 *   npx tsx scripts/fix-gmail-connection.ts --email shaymida337@gmail.com --target-org <orgId>
 *   npx tsx scripts/fix-gmail-connection.ts --email shaymida337@gmail.com --target-org <orgId> --apply
 */
import { PrismaClient } from "@prisma/client";
import {
  collectMailboxConflicts,
  collectRefreshTokenConflicts,
} from "../src/services/gmailIntegrationIsolation.js";

const APPLY = process.argv.includes("--apply");
const INCLUDE_UNPROVEN = process.argv.includes("--include-unproven-legacy");
function argValue(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : null;
}
const email = argValue("--email")?.trim().toLowerCase() ?? null;
const targetOrg = argValue("--target-org")?.trim() ?? null;
if (!email || !targetOrg) {
  console.error("Usage: npx tsx scripts/fix-gmail-connection.ts --email <gmail> --target-org <orgId> [--apply] [--include-unproven-legacy]");
  process.exit(1);
}

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
  console.log(`fix-gmail-connection | ${new Date().toISOString()} | mode=${APPLY ? "APPLY" : "DRY-RUN"}`);
  console.log(`email=${email} targetOrg=${targetOrg}\n`);

  // ── 1. איפה המשתמש באמת חבר ──
  const user = await prisma.user.findFirst({
    where: { email: { equals: email!, mode: "insensitive" } },
    select: {
      id: true,
      email: true,
      organizationMemberships: {
        select: { organizationId: true, role: true, organization: { select: { name: true } } },
      },
    },
  });
  const orgs = new Map(
    (await prisma.organization.findMany({ select: { id: true, name: true } })).map((o) => [o.id, o.name])
  );
  console.log("=== 1. חברויות המשתמש ===");
  if (!user) {
    console.log(`⚠️ לא נמצא משתמש עם המייל ${email} — החיבור ייעשה מהחשבון שאיתו הוא מחובר לאפליקציה.`);
  } else {
    for (const m of user.organizationMemberships) {
      const marker = m.organizationId === targetOrg ? "  ← TARGET" : "";
      console.log(`  org=${m.organizationId} ("${m.organization.name}") role=${m.role}${marker}`);
    }
    const isMember = user.organizationMemberships.some((m) => m.organizationId === targetOrg);
    if (!isMember) {
      console.log(`\n🛑 אזהרה קריטית: המשתמש אינו חבר ב---target-org (${targetOrg}, "${orgs.get(targetOrg!) ?? "?"}")!`);
      console.log("   ה-callback קושר את החיבור לארגון שבטוקן ההתחברות של המשתמש — לא ליעד שהוזן כאן.");
      console.log("   ודא שהמשתמש מחובר לאפליקציה בארגון הנכון לפני החיבור-מחדש.");
    }
  }

  // ── 2. סימולציית השערים — בדיוק כמו בשרת ──
  const integrations = await prisma.integration.findMany({
    where: { provider: "gmail" },
    select: { id: true, organizationId: true, metadata: true, refreshToken: true, connectedAt: true, updatedAt: true },
    orderBy: { connectedAt: "asc" },
  });

  const targetIntegration = integrations.find((i) => i.organizationId === targetOrg) ?? null;
  const referenceToken = targetIntegration?.refreshToken ?? null;

  // שער התיבה: התאמת אימייל בארגונים אחרים (עם refreshToken)
  const mailboxBlockerOrgs = new Set(
    collectMailboxConflicts(
      integrations.map((i) => ({ organizationId: i.organizationId, metadata: i.metadata, refreshToken: i.refreshToken })),
      email,
      targetOrg!
    )
  );
  // שער הטוקן: התאמת hash מול הטוקן השמור בארגון היעד (אם יש) —
  // גוגל מחזירה לרוב את אותו refresh token לאותו חשבון+client.
  const tokenBlockerIds = new Set(
    collectRefreshTokenConflicts(
      integrations.map((i) => ({ id: i.id, organizationId: i.organizationId, refreshToken: i.refreshToken })),
      referenceToken,
      { excludeOrganizationId: targetOrg! }
    ).map((c) => c.integrationId)
  );

  console.log("\n=== 2. כל אינטגרציות ה-Gmail + פסק-דין ===");
  const toDelete: typeof integrations = [];
  const unproven: typeof integrations = [];
  for (const integration of integrations) {
    const accEmail = metadataEmail(integration.metadata);
    const isTarget = integration.organizationId === targetOrg;
    const emailBlocks = mailboxBlockerOrgs.has(integration.organizationId) && accEmail === email;
    const tokenBlocks = tokenBlockerIds.has(integration.id);
    const legacyEmpty = !isTarget && !accEmail && Boolean(integration.refreshToken);
    let verdict: string;
    if (isTarget) verdict = "KEEP (ארגון היעד — יידרס ע\"י ה-upsert בחיבור)";
    else if (emailBlocks || tokenBlocks) {
      verdict = `${APPLY ? "DELETE" : "WOULD DELETE"} (${[emailBlocks && "email-match", tokenBlocks && "token-hash-match"].filter(Boolean).join("+")})`;
      toDelete.push(integration);
    } else if (legacyEmpty && !referenceToken) {
      verdict = INCLUDE_UNPROVEN
        ? `${APPLY ? "DELETE" : "WOULD DELETE"} (legacy ריק — --include-unproven-legacy)`
        : "SUSPECT (legacy ריק, אין טוקן ייחוס להוכחה — יימחק רק עם --include-unproven-legacy)";
      if (INCLUDE_UNPROVEN) toDelete.push(integration);
      else unproven.push(integration);
    } else verdict = "SKIP (לא חוסם)";
    console.log(
      `  org=${integration.organizationId} ("${orgs.get(integration.organizationId) ?? "?"}") | email=${accEmail ?? "-"} | hasToken=${Boolean(integration.refreshToken)} | connected=${integration.connectedAt.toISOString().slice(0, 10)} → ${verdict}`
    );
  }

  // ── 3. ביצוע + פסק-דין סופי ──
  console.log(`\n${APPLY ? "נמחקות" : "יימחקו"} ${toDelete.length} רשומות חוסמות.`);
  if (APPLY) {
    for (const integration of toDelete) {
      await prisma.integration.delete({ where: { id: integration.id } });
      console.log(`  DELETED integration=${integration.id} org=${integration.organizationId}`);
    }
  }

  console.log("\n=== 3. פסק-דין סופי ===");
  const provenCleared = APPLY || toDelete.length === 0;
  if (provenCleared && unproven.length === 0) {
    console.log(`✅ READY: חיבור של ${email} לארגון ${targetOrg} יעבור את שני שערי הבידוד.`);
    if (!APPLY && toDelete.length === 0) {
      console.log("   (לא נמצאו חוסמות בכלל — אם החיבור עדיין נכשל, הבעיה בזהות הארגון בטוקן ההתחברות, ר' סעיף 1)");
    }
  } else if (!APPLY) {
    console.log(`DRY-RUN: אחרי --apply יימחקו ${toDelete.length} חוסמות מוכחות.`);
  }
  if (unproven.length) {
    console.log(`⚠️ נותרו ${unproven.length} רשומות legacy ריקות לא-מוכחות (אין טוקן ייחוס בארגון היעד להשוואה).`);
    console.log("   אם החיבור עדיין נחסם עם token_already_bound — הרץ שוב עם --include-unproven-legacy,");
    console.log("   או זהה את החוסמת המדויקת בלוג: grep '[gmail-isolation]' (מכיל tokenAlreadyBoundTo=<orgIds>).");
  }
}

main()
  .catch((err) => {
    console.error("fix-gmail-connection failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
