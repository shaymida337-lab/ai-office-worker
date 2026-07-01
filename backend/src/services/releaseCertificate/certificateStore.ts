import type { Prisma, ReleaseCertificateRecord } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import type { ReleaseCertificate, ReleaseCertificateHistoryItem } from "./certificateTypes.js";

export type ReleaseCertificateDb = Pick<typeof prisma, "releaseCertificateRecord">;

export async function persistReleaseCertificate(
  organizationId: string,
  certificate: ReleaseCertificate,
  db: ReleaseCertificateDb = prisma,
): Promise<ReleaseCertificateRecord | null> {
  try {
    return await db.releaseCertificateRecord.create({
      data: {
        organizationId,
        certificateId: certificate.certificateId,
        timestamp: new Date(certificate.timestamp),
        commitHash: certificate.commitHash,
        deployId: certificate.deployId,
        environment: certificate.environment,
        overallStatus: certificate.overallStatus,
        overallScore: certificate.overallScore,
        gateResultsJson: certificate.gateResults as unknown as Prisma.InputJsonValue,
        failedGatesJson: certificate.failedGates as unknown as Prisma.InputJsonValue,
        warningGatesJson: certificate.warningGates as unknown as Prisma.InputJsonValue,
        releaseRecommendation: certificate.releaseRecommendation,
        explanation: certificate.explanation,
        certificateJson: certificate as unknown as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    console.error("[release-certificate] failed to persist history", certificate.certificateId, err);
    return null;
  }
}

export async function getLatestReleaseCertificate(
  organizationId: string,
  db: ReleaseCertificateDb = prisma,
): Promise<ReleaseCertificate | null> {
  const row = await db.releaseCertificateRecord.findFirst({
    where: { organizationId },
    orderBy: { timestamp: "desc" },
  });
  return row ? mapRowToCertificate(row) : null;
}

export async function getReleaseCertificateById(
  organizationId: string,
  certificateId: string,
  db: ReleaseCertificateDb = prisma,
): Promise<ReleaseCertificate | null> {
  const row = await db.releaseCertificateRecord.findFirst({
    where: { organizationId, certificateId },
  });
  return row ? mapRowToCertificate(row) : null;
}

export async function listReleaseCertificateHistory(
  organizationId: string,
  options: { limit?: number; cursor?: string } = {},
  db: ReleaseCertificateDb = prisma,
): Promise<{ items: ReleaseCertificateHistoryItem[]; nextCursor: string | null }> {
  const limit = Math.min(options.limit ?? 20, 100);
  const rows = await db.releaseCertificateRecord.findMany({
    where: { organizationId },
    orderBy: { timestamp: "desc" },
    take: limit + 1,
    ...(options.cursor
      ? {
          cursor: { id: options.cursor },
          skip: 1,
        }
      : {}),
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return {
    items: page.map((row) => ({
      certificateId: row.certificateId,
      timestamp: row.timestamp.toISOString(),
      commitHash: row.commitHash,
      deployId: row.deployId,
      environment: row.environment,
      overallStatus: row.overallStatus as ReleaseCertificate["overallStatus"],
      overallScore: row.overallScore,
      failedGates: row.failedGatesJson as ReleaseCertificate["failedGates"],
      warningGates: row.warningGatesJson as ReleaseCertificate["warningGates"],
      releaseRecommendation: row.releaseRecommendation,
    })),
    nextCursor: hasMore ? page[page.length - 1]!.id : null,
  };
}

function mapRowToCertificate(row: ReleaseCertificateRecord): ReleaseCertificate {
  const stored = row.certificateJson as ReleaseCertificate | null;
  if (stored && typeof stored === "object" && stored.certificateId) {
    return stored;
  }
  return {
    certificateId: row.certificateId,
    timestamp: row.timestamp.toISOString(),
    commitHash: row.commitHash,
    deployId: row.deployId,
    environment: row.environment,
    overallStatus: row.overallStatus as ReleaseCertificate["overallStatus"],
    overallScore: row.overallScore,
    gateResults: row.gateResultsJson as ReleaseCertificate["gateResults"],
    failedGates: row.failedGatesJson as ReleaseCertificate["failedGates"],
    warningGates: row.warningGatesJson as ReleaseCertificate["warningGates"],
    releaseRecommendation: row.releaseRecommendation,
    explanation: row.explanation,
    trustScore: 0,
  };
}
