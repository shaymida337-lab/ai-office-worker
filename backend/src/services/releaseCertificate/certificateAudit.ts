import { recordPlatformAudit, systemAuditContext } from "../auditLog/index.js";
import type { ReleaseCertificate } from "./certificateTypes.js";

export function recordReleaseCertificateAudit(input: {
  organizationId: string;
  certificate: ReleaseCertificate;
  sourceRoute: string | null;
  actorId: string | null;
}): void {
  recordPlatformAudit({
    ...systemAuditContext("releaseCertificate", input.certificate.certificateId),
    actorType: input.actorId ? "user" : "system",
    actorId: input.actorId ?? "release-certificate",
    organizationId: input.organizationId,
    entityType: "release_certificate",
    entityId: input.certificate.certificateId,
    action: "release_certificate_generated",
    severity: input.certificate.overallStatus === "RED" ? "critical" : "info",
    sourceRoute: input.sourceRoute,
    afterState: {
      overallStatus: input.certificate.overallStatus,
      overallScore: input.certificate.overallScore,
      failedGates: input.certificate.failedGates,
      warningGates: input.certificate.warningGates,
    },
    reason: input.certificate.explanation,
    metadata: {
      releaseRecommendation: input.certificate.releaseRecommendation,
      trustScore: input.certificate.trustScore,
      commitHash: input.certificate.commitHash,
      deployId: input.certificate.deployId,
    },
  });

  if (input.certificate.overallStatus === "RED") {
    recordPlatformAudit({
      ...systemAuditContext("releaseCertificate", input.certificate.certificateId),
      actorType: input.actorId ? "user" : "system",
      actorId: input.actorId ?? "release-certificate",
      organizationId: input.organizationId,
      entityType: "release_certificate",
      entityId: input.certificate.certificateId,
      action: "release_blocked",
      severity: "critical",
      sourceRoute: input.sourceRoute,
      afterState: {
        failedGates: input.certificate.failedGates,
        overallStatus: input.certificate.overallStatus,
      },
      reason: input.certificate.explanation,
      metadata: {
        releaseRecommendation: input.certificate.releaseRecommendation,
      },
    });
  }
}
