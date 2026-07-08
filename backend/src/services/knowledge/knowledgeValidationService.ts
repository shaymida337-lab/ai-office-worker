/**
 * Validation for Knowledge Center commands. Mirrors the calendar validation
 * convention ({ valid, issues[] }). Phase 1 is read-only, so validation is
 * light: the organization must exist and a lookup must carry something to
 * search on.
 */

import { prisma } from "../../lib/prisma.js";
import type { KnowledgeIntentExtraction } from "./knowledgeIntentParser.js";

export type KnowledgeValidationIssue = {
  code: string;
  message: string;
  field?: string;
};

export type KnowledgeValidationResult = {
  valid: boolean;
  issues: KnowledgeValidationIssue[];
};

function fail(code: string, message: string, field?: string): KnowledgeValidationResult {
  return { valid: false, issues: [{ code, message, field }] };
}

function ok(): KnowledgeValidationResult {
  return { valid: true, issues: [] };
}

export async function assertOrganizationExists(
  organizationId: string
): Promise<KnowledgeValidationResult> {
  if (!organizationId?.trim()) {
    return fail("ORG_REQUIRED", "organizationId is required", "organizationId");
  }
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true },
  });
  return org ? ok() : fail("ORG_NOT_FOUND", "Organization not found", "organizationId");
}

/** A knowledge lookup is valid as long as it resolved to a knowledge intent. */
export function validateKnowledgeIntent(
  extraction: KnowledgeIntentExtraction
): KnowledgeValidationResult {
  if (extraction.intent !== "knowledge_lookup") {
    return fail("UNKNOWN_COMMAND", "Not a knowledge lookup command");
  }
  return ok();
}
