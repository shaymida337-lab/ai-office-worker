import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../../lib/prisma.js";
import {
  recordReliabilityEvent,
  resolveReliabilityEvent,
} from "./reliabilityEventRepository.js";
import {
  noteDocumentApprovalFailure,
  noteStaleDashboardBanner,
  noteWhatsAppEmptyOrFailedReply,
  runReliabilitySelfHealing,
} from "./reliabilitySelfHealing.js";

type FakeRow = {
  id: string;
  organizationId: string | null;
  userId: string | null;
  module: string;
  severity: string;
  errorCode: string;
  userVisibleMessage: string | null;
  technicalMessage: string | null;
  route: string | null;
  component: string | null;
  job: string | null;
  correlationId: string | null;
  status: string;
  fingerprint: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  resolvedAt: Date | null;
  occurrences: number;
  autoHealed: boolean;
  customerVisible: boolean;
  metadata: unknown;
};

function installFakeReliabilityDb() {
  const rows: FakeRow[] = [];
  let seq = 0;
  const original = prisma.reliabilityEvent;

  (prisma as { reliabilityEvent: unknown }).reliabilityEvent = {
    findFirst: async ({ where }: { where: Record<string, unknown> }) => {
      return (
        rows.find((row) => {
          if (where.id && row.id !== where.id) return false;
          if (where.fingerprint && row.fingerprint !== where.fingerprint) return false;
          if (where.status && row.status !== where.status) return false;
          if (where.organizationId && row.organizationId !== where.organizationId) return false;
          if (where.errorCode && row.errorCode !== where.errorCode) return false;
          if (where.module && row.module !== where.module) return false;
          return true;
        }) ?? null
      );
    },
    findMany: async ({ where }: { where?: Record<string, unknown> } = {}) =>
      rows.filter((row) => {
        if (where?.status && row.status !== where.status) return false;
        if (where?.organizationId && row.organizationId !== where.organizationId) return false;
        if (where?.module && row.module !== where.module) return false;
        return true;
      }),
    create: async ({ data }: { data: Omit<FakeRow, "id"> }) => {
      const row: FakeRow = { id: `evt-${++seq}`, ...data };
      rows.push(row);
      return { ...row };
    },
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => {
      const row = rows.find((item) => item.id === where.id);
      if (!row) throw new Error("missing");
      if (
        data.occurrences &&
        typeof data.occurrences === "object" &&
        data.occurrences !== null &&
        "increment" in (data.occurrences as object)
      ) {
        row.occurrences += Number((data.occurrences as { increment: number }).increment);
      } else if (typeof data.occurrences === "number") {
        row.occurrences = data.occurrences;
      }
      for (const [key, value] of Object.entries(data)) {
        if (key === "occurrences") continue;
        (row as Record<string, unknown>)[key] = value;
      }
      return { ...row };
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: { id?: { in: string[] } };
      data: Record<string, unknown>;
    }) => {
      let count = 0;
      for (const row of rows) {
        if (where.id?.in && !where.id.in.includes(row.id)) continue;
        Object.assign(row, data);
        count += 1;
      }
      return { count };
    },
    count: async () => rows.filter((row) => row.autoHealed && row.status === "resolved").length,
  };

  return {
    rows,
    restore: () => {
      (prisma as { reliabilityEvent: unknown }).reliabilityEvent = original;
    },
  };
}

test("persistent event creation and aggregation of repeats", async () => {
  const fake = installFakeReliabilityDb();
  try {
    const first = await recordReliabilityEvent({
      organizationId: "org-1",
      module: "document_review",
      severity: "error",
      errorCode: "DOCUMENT_APPROVAL_FAILED",
      userVisibleMessage: "אישור מסמך נכשל",
      technicalMessage: "trust gate blocked",
      route: "POST /document-reviews/:id/approve",
      customerVisible: true,
    });
    assert.equal(first.created, true);
    assert.equal(first.event.occurrences, 1);

    const second = await recordReliabilityEvent({
      organizationId: "org-1",
      module: "document_review",
      severity: "error",
      errorCode: "DOCUMENT_APPROVAL_FAILED",
      userVisibleMessage: "אישור מסמך נכשל",
      technicalMessage: "trust gate blocked again",
      route: "POST /document-reviews/:id/approve",
      customerVisible: true,
    });
    assert.equal(second.created, false);
    assert.equal(second.event.occurrences, 2);
    assert.equal(fake.rows.length, 1, "repeated errors must aggregate on one open row");
  } finally {
    fake.restore();
  }
});

test("resolving event after recovery marks status resolved", async () => {
  const fake = installFakeReliabilityDb();
  try {
    const created = await recordReliabilityEvent({
      organizationId: "org-1",
      module: "dashboard",
      severity: "warning",
      errorCode: "STALE_TIMEOUT_BANNER",
      customerVisible: true,
    });
    const resolved = await resolveReliabilityEvent({
      eventId: created.event.id,
      autoHealed: true,
    });
    assert.ok(resolved);
    assert.equal(resolved!.status, "resolved");
    assert.equal(resolved!.autoHealed, true);
    assert.ok(resolved!.resolvedAt);
  } finally {
    fake.restore();
  }
});

test("failed document approval creates persistent event", async () => {
  const fake = installFakeReliabilityDb();
  try {
    const result = await noteDocumentApprovalFailure({
      organizationId: "org-1",
      reviewId: "review-1",
      message: "Cannot approve document without a verified total amount",
    });
    assert.equal(result.created, true);
    assert.equal(result.event.errorCode, "DOCUMENT_APPROVAL_FAILED");
    assert.equal(result.event.module, "document_review");
    assert.equal(result.event.customerVisible, true);
  } finally {
    fake.restore();
  }
});

test("WhatsApp empty reply creates persistent event", async () => {
  const fake = installFakeReliabilityDb();
  try {
    const result = await noteWhatsAppEmptyOrFailedReply({
      organizationId: "org-1",
      correlationId: "WA-1",
      reason: "empty_reply",
    });
    assert.equal(result.event.errorCode, "WHATSAPP_EMPTY_REPLY");
    assert.equal(result.event.module, "whatsapp");
  } finally {
    fake.restore();
  }
});

test("stale dashboard banner note + clear when scan state is clean", async () => {
  const fake = installFakeReliabilityDb();
  try {
    await noteStaleDashboardBanner({ organizationId: "org-1", reason: "timeout banner visible" });
    assert.equal(fake.rows[0]?.errorCode, "STALE_TIMEOUT_BANNER");
    assert.equal(fake.rows[0]?.status, "open");

    const healing = await runReliabilitySelfHealing({
      organizationId: "org-1",
      deps: {
        reapOverdueLegacyScanLogs: async () => 0,
        closeStaleGmailScansForOrg: async () => [],
        countActiveGmailSyncScans: async () => 0,
        countActiveLegacyScanLogs: async () => 0,
      },
    });
    assert.ok(healing.resolvedEvents >= 1);
    assert.equal(fake.rows[0]?.status, "resolved");
  } finally {
    fake.restore();
  }
});

test("zombie scan auto-heal records then resolves reliability event", async () => {
  const fake = installFakeReliabilityDb();
  try {
    const healing = await runReliabilitySelfHealing({
      organizationId: "org-1",
      deps: {
        reapOverdueLegacyScanLogs: async () => 12,
        closeStaleGmailScansForOrg: async () => [],
        countActiveGmailSyncScans: async () => 0,
        countActiveLegacyScanLogs: async () => 0,
      },
    });
    assert.equal(healing.closedLegacyScanLogs, 12);
    assert.equal(healing.recordedEvents, 1);
    assert.equal(healing.resolvedEvents, 1);
    const zombie = fake.rows.find((row) => row.errorCode === "LEGACY_SCANLOG_ZOMBIE");
    assert.ok(zombie);
    assert.equal(zombie!.status, "resolved");
    assert.equal(zombie!.autoHealed, true);
  } finally {
    fake.restore();
  }
});
