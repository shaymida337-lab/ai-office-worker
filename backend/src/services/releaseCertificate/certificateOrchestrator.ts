import { generateReleaseCertificate } from "./certificateEngine.js";
import { recordReleaseCertificateAudit } from "./certificateAudit.js";
import { emitReleaseCertificateReliabilityEvent } from "./certificateReliability.js";
import { persistReleaseCertificate } from "./certificateStore.js";
import type { ReleaseCertificate, ReleaseCertificateGenerateContext } from "./certificateTypes.js";

export async function generateAndRecordReleaseCertificate(
  context: ReleaseCertificateGenerateContext,
  options?: { sourceRoute?: string | null; actorId?: string | null },
): Promise<ReleaseCertificate> {
  const certificate = await generateReleaseCertificate(context);
  await persistReleaseCertificate(context.organizationId, certificate);
  recordReleaseCertificateAudit({
    organizationId: context.organizationId,
    certificate,
    sourceRoute: options?.sourceRoute ?? null,
    actorId: options?.actorId ?? null,
  });
  emitReleaseCertificateReliabilityEvent({
    organizationId: context.organizationId,
    certificate,
  });
  return certificate;
}
