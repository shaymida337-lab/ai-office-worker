function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const previous = new Array<number>(b.length + 1);
  const current = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) previous[j] = j;
  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + substitutionCost);
    }
    for (let j = 0; j <= b.length; j++) previous[j] = current[j];
  }
  return previous[b.length]!;
}

function similarityScore(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshteinDistance(a, b) / maxLen;
}

export const MATCH_PRIORITY = {
  EXACT_FULL: 1,
  EXACT_TOKEN: 2,
  STARTS_WITH: 3,
  CONTAINS_TOKEN: 4,
  FUZZY: 5,
  NONE: 99,
} as const;

export type CustomerMatchPriority = (typeof MATCH_PRIORITY)[keyof typeof MATCH_PRIORITY];

export type RankedCustomerMatch<T extends { name: string }> = T & {
  matchPriority: CustomerMatchPriority;
  matchScore: number;
};

/** Normalize Hebrew customer names for deterministic comparison. */
export function normalizeCustomerNameForMatch(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[֑-ׇ]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function tokenizeCustomerName(normalized: string): string[] {
  return normalized.split(/\s+/u).filter(Boolean);
}

export function computeCustomerMatchPriority(
  query: string,
  candidateName: string
): { priority: CustomerMatchPriority; score: number } {
  const q = normalizeCustomerNameForMatch(query);
  const c = normalizeCustomerNameForMatch(candidateName);
  if (!q || !c) return { priority: MATCH_PRIORITY.NONE, score: 0 };
  if (q === c) return { priority: MATCH_PRIORITY.EXACT_FULL, score: 1 };

  const qTokens = tokenizeCustomerName(q);
  const cTokens = tokenizeCustomerName(c);

  if (qTokens.length > 1 && qTokens.every((token, index) => cTokens[index] === token)) {
    return { priority: MATCH_PRIORITY.EXACT_TOKEN, score: 1 };
  }

  if (qTokens.length === 1 && cTokens.includes(q)) {
    return { priority: MATCH_PRIORITY.EXACT_TOKEN, score: 1 };
  }

  if (c.startsWith(`${q} `) || cTokens[0] === q) {
    return { priority: MATCH_PRIORITY.STARTS_WITH, score: 0.9 };
  }

  if (cTokens.some((token) => token === q)) {
    return { priority: MATCH_PRIORITY.CONTAINS_TOKEN, score: 0.8 };
  }

  if (cTokens.some((token) => token.includes(q) && token !== q)) {
    return { priority: MATCH_PRIORITY.FUZZY, score: 0.5 };
  }

  const fullSim = similarityScore(q, c);
  if (fullSim >= 0.65) {
    return { priority: MATCH_PRIORITY.FUZZY, score: fullSim };
  }

  return { priority: MATCH_PRIORITY.NONE, score: 0 };
}

export function rankCustomerMatches<T extends { name: string }>(
  query: string,
  candidates: T[]
): RankedCustomerMatch<T>[] {
  return candidates
    .map((candidate) => {
      const { priority, score } = computeCustomerMatchPriority(query, candidate.name);
      return { ...candidate, matchPriority: priority, matchScore: score };
    })
    .filter((candidate) => candidate.matchPriority !== MATCH_PRIORITY.NONE)
    .sort((a, b) => {
      if (a.matchPriority !== b.matchPriority) return a.matchPriority - b.matchPriority;
      if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
      return a.name.localeCompare(b.name, "he");
    });
}

export function bestTierMatches<T extends { name: string }>(
  query: string,
  candidates: T[]
): RankedCustomerMatch<T>[] {
  const ranked = rankCustomerMatches(query, candidates);
  if (ranked.length === 0) return [];
  const bestPriority = ranked[0]!.matchPriority;
  return ranked.filter((candidate) => candidate.matchPriority === bestPriority);
}

export function resolveRankedCustomerMatches<T extends { id: string; name: string }>(
  query: string,
  candidates: T[]
): { kind: "resolved"; match: T } | { kind: "ambiguous"; matches: T[] } | { kind: "none" } {
  const tier = bestTierMatches(query, candidates);
  if (tier.length === 0) return { kind: "none" };
  if (tier.length === 1) return { kind: "resolved", match: tier[0]! };
  return { kind: "ambiguous", matches: tier };
}
