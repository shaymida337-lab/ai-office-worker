import { normalizeSupplierName, normalizeSupplierTaxId } from "../dedup/sharedMatcher.js";
import {
  buildGlobalSupplierDnaSeed,
  lookupSupplierByAlias,
  lookupSupplierByVat,
  mergeSupplierRegistries,
  registryForOrganization,
  resolveCanonicalDisplayName,
} from "./supplierRegistry.js";
import type {
  CanonicalSupplierInput,
  RankedSupplierCandidate,
  RejectedSupplierCandidate,
  SupplierCandidate,
  SupplierCandidateKind,
  SupplierDecision,
  SupplierEvidenceItem,
  SupplierReasonCode,
} from "./supplierTypes.js";
import {
  isStrongEvidenceKind,
  isValidSupplierCandidate,
  isWeakEvidenceKind,
  normalizeSupplierDisplayName,
  rejectSupplierCandidateReason,
} from "./supplierValidation.js";

const KIND_TIER: Record<SupplierCandidateKind, number> = {
  user_corrected: 100,
  vat_registry: 95,
  document_labeled: 90,
  ocr_keyword: 85,
  historical: 75,
  ai_extracted: 70,
  brand_alias: 65,
  email_domain: 30,
  sender_display: 25,
  phone: 0,
  address: 0,
  unknown: 10,
};

const SOURCE_PRIORITY: Record<string, number> = {
  user_input: 6,
  registry: 5,
  regex_gmail: 4,
  ocr_keyword: 4,
  claude_file: 3,
  claude_email: 3,
  reprocess: 3,
  parsed_fields_json: 2,
  sender: 1,
  domain: 1,
  learning: 2,
};

const STRONG_AUTO_SAVE_CONFIDENCE = 0.75;
const AMBIGUOUS_SCORE_GAP = 800;

function reasonCodeForKind(kind: SupplierCandidateKind): SupplierReasonCode {
  switch (kind) {
    case "user_corrected":
      return "USER_CORRECTED";
    case "vat_registry":
      return "VAT_REGISTRY";
    case "document_labeled":
      return "DOCUMENT_LABELED";
    case "ocr_keyword":
      return "OCR_KEYWORD";
    case "historical":
      return "HISTORICAL_MATCH";
    case "ai_extracted":
      return "AI_EXTRACTED";
    case "brand_alias":
      return "BRAND_ALIAS";
    case "email_domain":
      return "EMAIL_DOMAIN";
    case "sender_display":
      return "SENDER_DISPLAY";
    default:
      return "REJECTED_INVALID";
  }
}

function dedupeCandidates(candidates: SupplierCandidate[]) {
  const seen = new Set<string>();
  const unique: SupplierCandidate[] = [];
  for (const candidate of candidates) {
    const key = [
      candidate.kind,
      candidate.source,
      normalizeSupplierName(candidate.name),
      candidate.vatNumber ?? "",
      candidate.label ?? "",
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(candidate);
  }
  return unique;
}

function rankCandidate(candidate: SupplierCandidate): RankedSupplierCandidate {
  const tier = KIND_TIER[candidate.kind] ?? 10;
  const sourceBoost = SOURCE_PRIORITY[candidate.source] ?? 0;
  const confidenceBoost = (candidate.confidence ?? 0.5) * 10;
  return {
    ...candidate,
    normalizedName: normalizeSupplierName(candidate.name),
    tier,
    score: tier * 100 + sourceBoost * 10 + confidenceBoost,
  };
}

type RegistryMatch = {
  canonicalSupplier: string;
  canonicalName: string;
  vatNumber: string | null;
  aliases: string[];
  domains: string[];
  emails: string[];
  phones: string[];
  isBlocklisted: boolean;
  matchType: "vat" | "alias";
};

function matchCandidateToRegistry(
  candidate: RankedSupplierCandidate,
  registry: ReturnType<typeof mergeSupplierRegistries>
): RegistryMatch | null {
  const vat = normalizeSupplierTaxId(candidate.vatNumber);
  if (vat) {
    const byVat = lookupSupplierByVat(registry, vat);
    if (byVat) {
      return {
        canonicalSupplier: byVat.canonicalSupplier,
        canonicalName: byVat.canonicalName,
        vatNumber: byVat.vatNumber,
        aliases: byVat.aliases,
        domains: byVat.emailDomains,
        emails: byVat.knownEmails,
        phones: byVat.knownPhones,
        isBlocklisted: byVat.isBlocklisted,
        matchType: "vat",
      };
    }
  }
  const byAlias = lookupSupplierByAlias(registry, candidate.name);
  if (byAlias) {
    return {
      canonicalSupplier: byAlias.canonicalSupplier,
      canonicalName: byAlias.canonicalName,
      vatNumber: byAlias.vatNumber,
      aliases: byAlias.aliases,
      domains: byAlias.emailDomains,
      emails: byAlias.knownEmails,
      phones: byAlias.knownPhones,
      isBlocklisted: byAlias.isBlocklisted,
      matchType: "alias",
    };
  }
  return null;
}

function evidenceTypeForKind(kind: SupplierCandidateKind): SupplierEvidenceItem["type"] {
  switch (kind) {
    case "user_corrected":
      return "correction";
    case "vat_registry":
      return "vat";
    case "document_labeled":
      return "regex";
    case "ocr_keyword":
      return "ocr";
    case "historical":
      return "historical";
    case "ai_extracted":
      return "claude";
    case "brand_alias":
      return "brand_alias";
    case "email_domain":
      return "email_domain";
    case "sender_display":
      return "claude";
    default:
      return "regex";
  }
}

function buildEvidenceForWinner(
  winner: RankedSupplierCandidate,
  corroborating: RankedSupplierCandidate[],
  registryMatch: RegistryMatch | null
): SupplierEvidenceItem[] {
  const evidence: SupplierEvidenceItem[] = [];
  const add = (item: SupplierEvidenceItem) => {
    const key = `${item.type}|${item.value}`;
    if (evidence.some((existing) => `${existing.type}|${existing.value}` === key)) return;
    evidence.push(item);
  };

  add({
    type: evidenceTypeForKind(winner.kind),
    label: winner.label ?? winner.kind,
    value: winner.name,
    weight: winner.tier / 100,
    matched: true,
    source: winner.source,
  });

  if (registryMatch?.matchType === "vat" && registryMatch.vatNumber) {
    add({
      type: "vat",
      label: "VAT registry",
      value: registryMatch.vatNumber,
      weight: 0.95,
      matched: true,
      source: "registry",
    });
  }
  if (registryMatch?.matchType === "alias") {
    add({
      type: "brand_alias",
      label: "Canonical alias",
      value: registryMatch.canonicalName,
      weight: 0.65,
      matched: true,
      source: "registry",
    });
  }

  for (const candidate of corroborating) {
    if (candidate === winner) continue;
    add({
      type: evidenceTypeForKind(candidate.kind),
      label: candidate.label ?? candidate.kind,
      value: candidate.name,
      weight: candidate.tier / 100,
      matched: true,
      source: candidate.source,
    });
  }

  return evidence;
}

function countStrongKinds(candidates: RankedSupplierCandidate[]) {
  return new Set(candidates.filter((candidate) => isStrongEvidenceKind(candidate.kind)).map((candidate) => candidate.kind)).size;
}

function entitiesEquivalent(left: RankedSupplierCandidate, right: RankedSupplierCandidate, registry: ReturnType<typeof mergeSupplierRegistries>) {
  if (left.normalizedName && left.normalizedName === right.normalizedName) return true;
  const leftMatch = matchCandidateToRegistry(left, registry);
  const rightMatch = matchCandidateToRegistry(right, registry);
  return Boolean(leftMatch && rightMatch && leftMatch.canonicalSupplier === rightMatch.canonicalSupplier);
}

function missingDecision(rejected: RejectedSupplierCandidate[], reason: string): SupplierDecision {
  return {
    supplierName: null,
    canonicalSupplier: null,
    normalizedName: "",
    vatNumber: null,
    domains: [],
    emails: [],
    phones: [],
    aliases: [],
    logo: null,
    confidence: 0,
    evidenceScore: 0,
    reason,
    reasonCode: "MISSING",
    evidence: [],
    candidates: [],
    rejected,
    status: "missing",
    ambiguityFlags: [],
    version: "sir-v1",
    isStrongEnoughForAutoSave: false,
  };
}

export function computeCanonicalSupplier(input: CanonicalSupplierInput): SupplierDecision {
  const ownerEmails = input.ownerEmails ?? new Set<string>();
  const registry = input.registry?.length
    ? mergeSupplierRegistries(buildGlobalSupplierDnaSeed(), input.registry)
    : registryForOrganization({ organizationId: input.organizationId });

  const rejected: RejectedSupplierCandidate[] = [];
  const accepted: RankedSupplierCandidate[] = [];

  for (const candidate of dedupeCandidates(input.candidates)) {
    const rejectReason = rejectSupplierCandidateReason(candidate, ownerEmails);
    if (rejectReason) {
      rejected.push({ ...candidate, reason: rejectReason });
      continue;
    }
    accepted.push(rankCandidate(candidate));
  }

  accepted.sort((left, right) => right.score - left.score || left.name.localeCompare(right.name));

  const strongAccepted = accepted.filter((candidate) => isStrongEvidenceKind(candidate.kind));
  const weakAccepted = accepted.filter((candidate) => isWeakEvidenceKind(candidate.kind));

  if (accepted.length === 0) {
    return missingDecision(rejected, "No viable supplier candidates remained after validation");
  }

  if (strongAccepted.length === 0) {
    return missingDecision(
      rejected,
      weakAccepted.length > 1
        ? "Only weak sender/domain evidence available; never guess supplier from email or domain alone"
        : "Only weak sender/domain evidence available; never guess supplier from email or domain alone"
    );
  }

  const winner = strongAccepted[0];
  const runnerUp = strongAccepted[1] ?? null;
  const registryMatch = matchCandidateToRegistry(winner, registry);

  if (registryMatch?.isBlocklisted) {
    return {
      supplierName: null,
      canonicalSupplier: registryMatch.canonicalSupplier,
      normalizedName: normalizeSupplierName(registryMatch.canonicalName),
      vatNumber: registryMatch.vatNumber,
      domains: registryMatch.domains,
      emails: registryMatch.emails,
      phones: registryMatch.phones,
      aliases: registryMatch.aliases,
      logo: null,
      confidence: 0,
      evidenceScore: 0,
      reason: `Supplier entity ${registryMatch.canonicalName} is blocklisted for auto-save`,
      reasonCode: "BLOCKLISTED",
      evidence: [],
      candidates: accepted,
      rejected,
      status: "rejected",
      ambiguityFlags: ["blocklisted_entity"],
      version: "sir-v1",
      isStrongEnoughForAutoSave: false,
    };
  }

  if (
    runnerUp &&
    !entitiesEquivalent(winner, runnerUp, registry) &&
    runnerUp.score >= winner.score - AMBIGUOUS_SCORE_GAP
  ) {
    return {
      supplierName: null,
      canonicalSupplier: null,
      normalizedName: "",
      vatNumber: normalizeSupplierTaxId(winner.vatNumber) || registryMatch?.vatNumber || null,
      domains: [],
      emails: [],
      phones: [],
      aliases: [],
      logo: null,
      confidence: Math.min(winner.confidence ?? 0.5, runnerUp.confidence ?? 0.5),
      evidenceScore: (winner.score + runnerUp.score) / 200,
      reason: `Conflicting supplier candidates ${winner.name} vs ${runnerUp.name}`,
      reasonCode: "AMBIGUOUS",
      evidence: buildEvidenceForWinner(winner, [runnerUp], registryMatch),
      candidates: accepted,
      rejected,
      status: "ambiguous",
      ambiguityFlags: ["multiple_entities"],
      version: "sir-v1",
      isStrongEnoughForAutoSave: false,
    };
  }

  const corroborating = strongAccepted.filter(
    (candidate) => candidate !== winner && entitiesEquivalent(candidate, winner, registry)
  );
  const distinctStrongKinds = countStrongKinds([winner, ...corroborating]);
  const baseConfidence = Math.min(0.98, (winner.confidence ?? 0.6) + Math.max(0, distinctStrongKinds - 1) * 0.05);
  const registryBoost = registryMatch ? 0.05 : 0;
  const confidence = Math.min(0.999, baseConfidence + registryBoost);

  const supplierName = registryMatch
    ? resolveCanonicalDisplayName(
        {
          canonicalSupplier: registryMatch.canonicalSupplier,
          canonicalName: registryMatch.canonicalName,
          normalizedName: normalizeSupplierName(registryMatch.canonicalName),
          aliases: registryMatch.aliases,
          ocrVariants: [],
          vatNumber: registryMatch.vatNumber,
          emailDomains: registryMatch.domains,
          knownEmails: registryMatch.emails,
          knownPhones: registryMatch.phones,
          category: "other",
          isBlocklisted: false,
          typicalLanguage: "mixed",
          typicalCurrency: "ILS",
          historicalConfidence: 0,
          correctionsCount: 0,
          invoicesCount: 0,
          firstSeenAt: null,
          lastSeenAt: null,
        },
        winner.name
      )
    : normalizeSupplierDisplayName(winner.name);

  const reasonCode: SupplierReasonCode =
    winner.kind === "user_corrected"
      ? "USER_CORRECTED"
      : registryMatch?.matchType === "vat"
        ? corroborating.length > 0
          ? "VAT_REGISTRY"
          : "VAT_REGISTRY"
        : reasonCodeForKind(winner.kind);

  const evidence = buildEvidenceForWinner(winner, corroborating, registryMatch);
  const evidenceScore = evidence.reduce((sum, item) => sum + (item.matched ? item.weight : 0), 0);
  const isStrongEnoughForAutoSave =
    confidence >= STRONG_AUTO_SAVE_CONFIDENCE &&
    (winner.kind === "user_corrected" ||
      winner.kind === "vat_registry" ||
      registryMatch !== null ||
      distinctStrongKinds >= 2);

  return {
    supplierName,
    canonicalSupplier: registryMatch?.canonicalSupplier ?? null,
    normalizedName: normalizeSupplierName(supplierName),
    vatNumber: normalizeSupplierTaxId(winner.vatNumber) || registryMatch?.vatNumber || null,
    domains: registryMatch?.domains ?? [],
    emails: registryMatch?.emails ?? [],
    phones: registryMatch?.phones ?? [],
    aliases: registryMatch ? uniqueAliases(registryMatch.canonicalName, registryMatch.aliases) : [],
    logo: null,
    confidence,
    evidenceScore,
    reason: buildReasonSentence(winner, corroborating, registryMatch, reasonCode),
    reasonCode,
    evidence,
    candidates: accepted,
    rejected,
    status: "resolved",
    ambiguityFlags: [],
    version: "sir-v1",
    isStrongEnoughForAutoSave,
  };
}

function uniqueAliases(canonicalName: string, aliases: string[]) {
  const out = [canonicalName, ...aliases];
  return [...new Set(out.map((value) => value.trim()).filter(Boolean))];
}

function buildReasonSentence(
  winner: RankedSupplierCandidate,
  corroborating: RankedSupplierCandidate[],
  registryMatch: RegistryMatch | null,
  reasonCode: SupplierReasonCode
) {
  if (reasonCode === "USER_CORRECTED") return `User correction selected ${winner.name}`;
  if (registryMatch?.matchType === "vat") {
    return corroborating.length > 0
      ? `VAT ${registryMatch.vatNumber} matched registry and was corroborated by ${corroborating.length} additional evidence source(s)`
      : `VAT ${registryMatch.vatNumber} matched supplier registry for ${registryMatch.canonicalName}`;
  }
  if (registryMatch?.matchType === "alias") return `Supplier alias matched canonical entity ${registryMatch.canonicalName}`;
  if (corroborating.length > 0) {
    return `${winner.kind} selected ${winner.name} with ${corroborating.length} corroborating evidence source(s)`;
  }
  return `${winner.kind} selected ${winner.name}`;
}

export function supplierDecisionSelectedName(decision: SupplierDecision) {
  return decision.supplierName;
}

export { isValidSupplierCandidate };
