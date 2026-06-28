/**
 * Staging-only pilot toggle for org-level Calendar Engine flags.
 *
 * Requires CALENDAR_ENGINE_PILOT_ADMIN=true (never set in production).
 *
 * Usage:
 *   cd backend
 *   CALENDAR_ENGINE_PILOT_ADMIN=true npx tsx scripts/calendar-engine-pilot-org.ts list
 *   CALENDAR_ENGINE_PILOT_ADMIN=true npx tsx scripts/calendar-engine-pilot-org.ts enable --org-id <id> [--google-mirror] [--notes "pilot wave 1"]
 *   CALENDAR_ENGINE_PILOT_ADMIN=true npx tsx scripts/calendar-engine-pilot-org.ts disable --org-id <id>
 *   CALENDAR_ENGINE_PILOT_ADMIN=true npx tsx scripts/calendar-engine-pilot-org.ts enable --org-id <id> --dry-run
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";
import {
  isGlobalCalendarEngineReadEnabled,
  isGlobalCalendarEngineWriteEnabled,
  resolveCalendarEngineFlags,
} from "../src/services/calendar/calendarEngineFlags.js";

function requirePilotAdmin() {
  if (process.env.CALENDAR_ENGINE_PILOT_ADMIN !== "true") {
    console.error("Refused: set CALENDAR_ENGINE_PILOT_ADMIN=true for staging pilot toggles.");
    process.exit(1);
  }
  if (process.env.NODE_ENV === "production") {
    console.error("Refused: pilot toggles are blocked when NODE_ENV=production.");
    process.exit(1);
  }
}

function parseArgs(argv: string[]) {
  const command = argv[0] ?? "help";
  const flags: Record<string, string | boolean> = {};
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      flags.dryRun = true;
      continue;
    }
    if (arg === "--google-mirror") {
      flags.googleMirror = true;
      continue;
    }
    if (arg.startsWith("--") && argv[i + 1]) {
      flags[arg.slice(2)] = argv[i + 1];
      i += 1;
    }
  }
  return { command, flags };
}

async function listOrgs() {
  const orgs = await prisma.organization.findMany({
    select: {
      id: true,
      name: true,
      calendarEngineReadEnabled: true,
      calendarEngineWriteEnabled: true,
      calendarEngineGoogleMirrorEnabled: true,
      calendarEnginePilotNotes: true,
      user: { select: { email: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  console.log("Global kill switches:");
  console.log(`  CALENDAR_ENGINE_V1_READ=${isGlobalCalendarEngineReadEnabled()}`);
  console.log(`  CALENDAR_ENGINE_V1_WRITE=${isGlobalCalendarEngineWriteEnabled()}`);
  console.log("");
  console.log(`Organizations (${orgs.length}):`);

  for (const org of orgs) {
    const effective = await resolveCalendarEngineFlags(org.id);
    console.log(
      [
        `- ${org.id}`,
        `name=${org.name}`,
        `email=${org.user.email}`,
        `orgRead=${org.calendarEngineReadEnabled}`,
        `orgWrite=${org.calendarEngineWriteEnabled}`,
        `orgGoogleMirror=${org.calendarEngineGoogleMirrorEnabled}`,
        `effective=${effective.source}`,
        `read=${effective.readEnabled}`,
        `write=${effective.writeEnabled}`,
        `googleMirror=${effective.googleMirrorEnabled}`,
        org.calendarEnginePilotNotes ? `notes=${org.calendarEnginePilotNotes}` : null,
      ]
        .filter(Boolean)
        .join(" | ")
    );
  }
}

async function setOrgFlags(
  orgId: string,
  patch: {
    calendarEngineReadEnabled: boolean;
    calendarEngineWriteEnabled: boolean;
    calendarEngineGoogleMirrorEnabled: boolean;
    calendarEnginePilotNotes?: string | null;
  },
  dryRun: boolean
) {
  const existing = await prisma.organization.findUnique({
    where: { id: orgId },
    select: {
      id: true,
      name: true,
      calendarEngineReadEnabled: true,
      calendarEngineWriteEnabled: true,
      calendarEngineGoogleMirrorEnabled: true,
      calendarEnginePilotNotes: true,
    },
  });

  if (!existing) {
    console.error(`Organization not found: ${orgId}`);
    process.exit(1);
  }

  console.log("Audit — before:");
  console.log(JSON.stringify(existing, null, 2));

  if (dryRun) {
    console.log("Dry-run — would apply:");
    console.log(JSON.stringify(patch, null, 2));
    const effective = await resolveCalendarEngineFlags(orgId);
    console.log("Effective flags remain unchanged in dry-run:", effective);
    return;
  }

  const updated = await prisma.organization.update({
    where: { id: orgId },
    data: patch,
    select: {
      id: true,
      name: true,
      calendarEngineReadEnabled: true,
      calendarEngineWriteEnabled: true,
      calendarEngineGoogleMirrorEnabled: true,
      calendarEnginePilotNotes: true,
    },
  });

  const effective = await resolveCalendarEngineFlags(orgId);
  console.log("Audit — after:");
  console.log(JSON.stringify(updated, null, 2));
  console.log("Effective flags:");
  console.log(JSON.stringify(effective, null, 2));
}

async function main() {
  requirePilotAdmin();
  const { command, flags } = parseArgs(process.argv.slice(2));
  const orgId = typeof flags["org-id"] === "string" ? flags["org-id"] : undefined;
  const dryRun = flags.dryRun === true;
  const notes = typeof flags.notes === "string" ? flags.notes : undefined;
  const googleMirror = flags.googleMirror === true;

  switch (command) {
    case "list":
      await listOrgs();
      break;
    case "enable":
      if (!orgId) {
        console.error("enable requires --org-id <id>");
        process.exit(1);
      }
      await setOrgFlags(
        orgId,
        {
          calendarEngineReadEnabled: true,
          calendarEngineWriteEnabled: true,
          calendarEngineGoogleMirrorEnabled: googleMirror,
          ...(notes !== undefined ? { calendarEnginePilotNotes: notes } : {}),
        },
        dryRun
      );
      break;
    case "disable":
      if (!orgId) {
        console.error("disable requires --org-id <id>");
        process.exit(1);
      }
      await setOrgFlags(
        orgId,
        {
          calendarEngineReadEnabled: false,
          calendarEngineWriteEnabled: false,
          calendarEngineGoogleMirrorEnabled: false,
          calendarEnginePilotNotes: notes ?? null,
        },
        dryRun
      );
      break;
    default:
      console.log("Commands: list | enable --org-id <id> [--google-mirror] [--notes text] [--dry-run] | disable --org-id <id> [--dry-run]");
      process.exit(command === "help" ? 0 : 1);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
