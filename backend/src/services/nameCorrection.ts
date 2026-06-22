const TRANSCRIPT_CORRECTION_STOP_WORDS = new Set([
  "תקבעי",
  "שעה",
  "מחר",
  "מחרתיים",
  "היום",
  "ראשון",
  "שני",
  "שלישי",
  "רביעי",
  "חמישי",
  "שישי",
  "שבת",
  "תור",
  "פגישה",
  "בשעה",
  "בבוקר",
  "בערב",
  "אחר",
  "הצהריים",
]);

const MIN_TOKEN_LENGTH = 3;
const MAX_EDIT_DISTANCE = 1;

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
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + substitutionCost
      );
    }
    for (let j = 0; j <= b.length; j++) previous[j] = current[j];
  }

  return previous[b.length];
}

function extractHebrewCore(token: string): { prefix: string; core: string; suffix: string } | null {
  const match = token.match(/^([^a-zA-Z\u0590-\u05FF]*)([\u0590-\u05FF]+)([^a-zA-Z\u0590-\u05FF]*)$/);
  if (!match) return null;
  const [, prefix, core, suffix] = match;
  if (!/^[\u0590-\u05FF]+$/.test(core)) return null;
  return { prefix, core, suffix };
}

function collectClientNameTokens(clientNames: string[]): string[] {
  return [
    ...new Set(
      clientNames
        .flatMap((name) => name.trim().split(/\s+/))
        .map((token) => token.trim())
        .filter(Boolean)
    ),
  ];
}

function findSingleCorrection(candidate: string, nameTokens: string[]): string | undefined {
  if (nameTokens.includes(candidate)) return undefined;

  const matches = nameTokens.filter((token) => levenshteinDistance(candidate, token) === MAX_EDIT_DISTANCE);
  return matches.length === 1 ? matches[0] : undefined;
}

export function correctClientNamesInTranscript(transcript: string, clientNames: string[]): string {
  if (!transcript.trim() || clientNames.length === 0) return transcript;

  const nameTokens = collectClientNameTokens(clientNames);
  if (nameTokens.length === 0) return transcript;

  const parts = transcript.split(/(\s+)/);
  const correctedParts = parts.map((part) => {
    if (/^\s+$/.test(part)) return part;

    const extracted = extractHebrewCore(part);
    if (!extracted) return part;

    const { prefix, core, suffix } = extracted;
    if (core.length < MIN_TOKEN_LENGTH) return part;
    if (TRANSCRIPT_CORRECTION_STOP_WORDS.has(core)) return part;

    const correction = findSingleCorrection(core, nameTokens);
    if (!correction) return part;

    return `${prefix}${correction}${suffix}`;
  });

  return correctedParts.join("");
}
