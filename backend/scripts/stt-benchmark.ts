/**
 * stt-benchmark.ts — מדידת דיוק תמלול (WER/CER) מקומית, לפני/אחרי כל תיקון.
 *
 * קלט: תיקייה benchmark-audio/ (מחוץ ל-git) עם זוגות:
 *   recording-01.mp4  +  recording-01.txt   (טקסט הייחוס המדויק)
 *   recording-02.webm +  recording-02.txt   ...  (כל סיומת אודיו נתמכת)
 *
 * לכל זוג: מתמלל ומחשב WER (word error rate) ו-CER (character error rate)
 * מול הייחוס, אחרי נרמול (הסרת ניקוד+פיסוק, איחוד רווחים).
 *
 * מסלול התמלול:
 *   - במודל ברירת המחדל (whisper-1) — דרך הקוד הקיים natalieStt.transcribeAudio
 *     בדיוק כמו בפרודקשן (לא עוקף).
 *   - במודל אחר (--model) — קריאה ישירה ל-OpenAI באותה צורת בקשה, כי הקוד
 *     הקיים מקבע את whisper-1 ואסור לגעת בו. מסומן בפלט כ-"direct".
 *
 * promptHint: אם --org והמסד המקומי (localhost) זמין — נבנה מאוצר-המילים של
 *   הארגון (loadSttVocabulary). אחרת — פרומפט הבסיס בלבד. מדווח מה שימש.
 *   ⚠️ טעינת אוצר-מילים מסורבת אם DATABASE_URL אינו localhost (לא נוגעים ב-Neon).
 *
 * הרצה:
 *   cd backend && npx tsx scripts/stt-benchmark.ts
 *   cd backend && npx tsx scripts/stt-benchmark.ts --model gpt-4o-transcribe --org <id>
 */
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, extname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import {
  transcribeAudio,
  WHISPER_MODEL,
  WHISPER_LANGUAGE,
  OPENAI_TRANSCRIPTION_URL,
} from "../src/services/natalieStt.js";
import { buildWhisperPromptHint, loadSttVocabulary, type SttVocabulary } from "../src/services/sttAccuracy/sttVocabulary.js";

const backendRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---- פרמטרים ----
function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}
const MODEL = argValue("--model") ?? WHISPER_MODEL;
const ORG = argValue("--org");
const RUNS = Math.max(1, Number(argValue("--runs") ?? 3) || 3);
const LANGUAGE = argValue("--language") ?? WHISPER_LANGUAGE;
const AUDIO_DIR = join(backendRoot, argValue("--dir") ?? "benchmark-audio");
const RESULTS_DIR = join(backendRoot, "stt-benchmark-results");
const USE_EXISTING_CODE = MODEL === WHISPER_MODEL;

// ---- env מקומי (בלי לייבא את כל config) ----
function readEnv(key: string): string | undefined {
  if (process.env[key]) return process.env[key];
  try {
    const envText = readFileSync(join(backendRoot, ".env"), "utf8");
    const line = envText.split(/\r?\n/).find((l) => l.startsWith(`${key}=`));
    return line ? line.slice(key.length + 1).replace(/^"|"$/g, "") : undefined;
  } catch {
    return undefined;
  }
}
const OPENAI_API_KEY = readEnv("OPENAI_API_KEY");
const DATABASE_URL = readEnv("DATABASE_URL") ?? "";
const dbHost = DATABASE_URL ? new URL(DATABASE_URL.replace(/^postgresql:/, "http:")).hostname : "";
const dbIsLocal = dbHost === "localhost" || dbHost === "127.0.0.1";

// ---- mimeType לפי סיומת (לזיהוי קובץ קלט) ----
const MIME_BY_EXT: Record<string, string> = {
  ".mp4": "audio/mp4", ".m4a": "audio/mp4", ".webm": "audio/webm",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg",
};
const AUDIO_EXTS = Object.keys(MIME_BY_EXT);

/**
 * מראה 1:1 של extensionForMimeType מ-natalieStt.ts (שם היא private ולא מיוצאת).
 * חובה שתהיה זהה כדי שה-filename בטופס יהיה זהה בין המסלול הישיר ל-natalieStt —
 * בפרט audio/mp4 → "m4a" (לא "mp4"). לעדכן כאן אם המקור משתנה.
 */
function extensionForMimeTypeMirror(mimeType: string): string {
  const base = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  const map: Record<string, string> = {
    "audio/webm": "webm",
    "audio/mp4": "m4a",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/ogg": "ogg",
  };
  return map[base] ?? "audio";
}

// ---- נרמול לפני השוואה ----
function normalizeForCompare(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[֑-ׇ]/g, "")      // ניקוד עברי
    .replace(/[^\p{L}\p{N}\s]/gu, " ")     // פיסוק → רווח
    .replace(/\s+/g, " ")                  // איחוד רווחים
    .trim()
    .toLowerCase();
}

// ---- Levenshtein (רמת פריטים) ----
function levenshtein<T>(a: T[], b: T[]): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

function computeWer(reference: string, hypothesis: string): number {
  const ref = normalizeForCompare(reference).split(" ").filter(Boolean);
  const hyp = normalizeForCompare(hypothesis).split(" ").filter(Boolean);
  if (ref.length === 0) return hyp.length === 0 ? 0 : 1;
  return levenshtein(ref, hyp) / ref.length;
}
function computeCer(reference: string, hypothesis: string): number {
  const ref = [...normalizeForCompare(reference)];
  const hyp = [...normalizeForCompare(hypothesis)];
  if (ref.length === 0) return hyp.length === 0 ? 0 : 1;
  return levenshtein(ref, hyp) / ref.length;
}

// ---- קריאה ישירה ל-OpenAI למודל שאינו ברירת המחדל ----
async function transcribeDirect(buffer: Buffer, mimeType: string, model: string, promptHint?: string): Promise<{ ok: boolean; text: string; error?: string }> {
  // בניית הבקשה זהה 1:1 ל-natalieStt.transcribeAudio — אותו normalizedMimeType,
  // אותו blob, אותו fieldname="file"/filename, אותו סדר שדות, language=he,
  // response_format=json, prompt רק אם קיים, וללא temperature. ההבדל היחיד: model.
  const form = new FormData();
  const normalizedMimeType = mimeType.split(";")[0]?.trim() || "application/octet-stream";
  const blob = new Blob([new Uint8Array(buffer)], { type: normalizedMimeType });
  form.append("file", blob, `recording.${extensionForMimeTypeMirror(normalizedMimeType)}`);
  form.append("model", model);
  form.append("language", LANGUAGE);
  form.append("response_format", "json");
  const trimmedPromptHint = promptHint?.trim();
  if (trimmedPromptHint) {
    form.append("prompt", trimmedPromptHint);
  }
  const res = await fetch(OPENAI_TRANSCRIPTION_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
  });
  if (!res.ok) return { ok: false, text: "", error: `${res.status}: ${(await res.text()).slice(0, 200)}` };
  const payload = (await res.json()) as { text?: string };
  return { ok: true, text: payload.text?.trim() ?? "" };
}

async function main() {
  console.log(`stt-benchmark | ${new Date().toISOString()} | model=${MODEL} (${USE_EXISTING_CODE ? "via natalieStt" : "direct"}) | language=${LANGUAGE} | runs=${RUNS}`);

  if (!OPENAI_API_KEY) {
    console.error("🛑 OPENAI_API_KEY חסר (backend/.env או משתנה סביבה). לא ניתן לתמלל.");
    process.exit(1);
  }
  if (!existsSync(AUDIO_DIR)) {
    console.error(`🛑 תיקיית האודיו לא נמצאה: ${AUDIO_DIR}`);
    console.error("   צור אותה והנח זוגות: recording-01.mp4 + recording-01.txt (טקסט ייחוס).");
    process.exit(1);
  }

  // promptHint
  let promptHint: string | undefined;
  let promptSource = "base";
  if (ORG) {
    if (!dbIsLocal) {
      console.warn(`⚠️  --org סופק אבל DATABASE_URL אינו localhost (host=${dbHost}). לא נוגעים ב-Neon — פרומפט בסיס בלבד.`);
    } else {
      try {
        const vocab = await loadSttVocabulary(ORG);
        promptHint = buildWhisperPromptHint(vocab);
        promptSource = `org:${ORG} (מסד מקומי)`;
      } catch (err) {
        console.warn(`⚠️  טעינת אוצר-מילים נכשלה (${err instanceof Error ? err.message : err}) — פרומפט בסיס.`);
      }
    }
  }
  if (!promptHint) {
    const emptyVocab: SttVocabulary = { organizationId: ORG ?? "benchmark", organizationName: null, clientNames: [], supplierNames: [], serviceNames: [], memberNames: [], businessTerms: [] };
    promptHint = buildWhisperPromptHint(emptyVocab);
  }
  console.log(`promptHint: ${promptSource} | "${(promptHint ?? "").slice(0, 90)}${(promptHint ?? "").length > 90 ? "…" : ""}"\n`);

  // זיווג קבצים
  const files = readdirSync(AUDIO_DIR);
  const audioFiles = files.filter((f) => AUDIO_EXTS.includes(extname(f).toLowerCase())).sort();
  if (audioFiles.length === 0) {
    console.error(`🛑 לא נמצאו קבצי אודיו ב-${AUDIO_DIR} (סיומות נתמכות: ${AUDIO_EXTS.join(", ")}).`);
    process.exit(1);
  }

  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

  type RunResult = { run: number; hypothesis: string; wer: number; cer: number; error?: string };
  type FileResult = {
    file: string; reference: string; runs: RunResult[];
    scoredRuns: number; errors: number;
    avgWer: number | null; minWer: number | null; maxWer: number | null;
    avgCer: number | null; minCer: number | null; maxCer: number | null;
  };
  const rows: FileResult[] = [];

  for (const audioFile of audioFiles) {
    const stem = basename(audioFile, extname(audioFile));
    const refPath = join(AUDIO_DIR, `${stem}.txt`);
    if (!existsSync(refPath)) {
      console.warn(`דילוג ${audioFile}: אין קובץ ייחוס ${stem}.txt`);
      continue;
    }
    const reference = readFileSync(refPath, "utf8").trim();
    const buffer = readFileSync(join(AUDIO_DIR, audioFile));
    const mimeType = MIME_BY_EXT[extname(audioFile).toLowerCase()] ?? "application/octet-stream";

    const runs: RunResult[] = [];
    for (let run = 1; run <= RUNS; run++) {
      let hypothesis = "";
      let error: string | undefined;
      try {
        const r = USE_EXISTING_CODE
          ? await transcribeAudio(buffer, mimeType, { openAiApiKey: OPENAI_API_KEY }, { fetchFn: fetch }, promptHint)
          : await transcribeDirect(buffer, mimeType, MODEL, promptHint);
        if (r.ok) hypothesis = r.text; else error = r.error;
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
      const wer = error ? 1 : computeWer(reference, hypothesis);
      const cer = error ? 1 : computeCer(reference, hypothesis);
      runs.push({ run, hypothesis, wer, cer, error });
    }

    const ok = runs.filter((r) => !r.error);
    const werList = ok.map((r) => r.wer);
    const cerList = ok.map((r) => r.cer);
    const fr: FileResult = {
      file: audioFile, reference, runs,
      scoredRuns: ok.length, errors: runs.length - ok.length,
      avgWer: ok.length ? mean(werList) : null,
      minWer: ok.length ? Math.min(...werList) : null,
      maxWer: ok.length ? Math.max(...werList) : null,
      avgCer: ok.length ? mean(cerList) : null,
      minCer: ok.length ? Math.min(...cerList) : null,
      maxCer: ok.length ? Math.max(...cerList) : null,
    };
    rows.push(fr);

    console.log(`▸ ${audioFile}  (${RUNS} הרצות, ${fr.errors ? `${fr.errors} שגיאות` : "ללא שגיאות"})`);
    console.log(`  ייחוס:  ${reference}`);
    console.log(`  תמלול (הרצה 1):  ${runs[0].error ? `[שגיאה: ${runs[0].error}]` : runs[0].hypothesis}`);
    if (fr.avgWer === null) {
      console.log(`  WER/CER: כל ההרצות נכשלו\n`);
    } else {
      console.log(`  WER: avg=${pct(fr.avgWer)} min=${pct(fr.minWer!)} max=${pct(fr.maxWer!)}  |  CER: avg=${pct(fr.avgCer!)} min=${pct(fr.minCer!)} max=${pct(fr.maxCer!)}\n`);
    }
  }

  const scored = rows.filter((r) => r.avgWer !== null);
  const overallWer = scored.length ? mean(scored.map((r) => r.avgWer!)) : null;
  const overallCer = scored.length ? mean(scored.map((r) => r.avgCer!)) : null;

  console.log("=".repeat(64));
  console.log(`קבצים: ${rows.length} | עם תמלול תקין: ${scored.length} | הרצות/קובץ: ${RUNS}`);
  console.log(`ממוצע כולל WER: ${overallWer === null ? "-" : pct(overallWer)} | ממוצע כולל CER: ${overallCer === null ? "-" : pct(overallCer)}`);

  // שמירת JSON (מחוץ ל-git)
  mkdirSync(RESULTS_DIR, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const safeModel = MODEL.replace(/[^a-zA-Z0-9._-]/g, "_");
  const outPath = join(RESULTS_DIR, `${date}-${safeModel}.json`);
  writeFileSync(outPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    model: MODEL,
    transcriptionPath: USE_EXISTING_CODE ? "natalieStt" : "direct",
    language: LANGUAGE,
    runsPerFile: RUNS,
    promptSource,
    promptHint,
    fileCount: rows.length,
    filesWithValidTranscript: scored.length,
    overallAverageWer: overallWer,
    overallAverageCer: overallCer,
    results: rows,   // כולל את כל ההרצות (runs[]) לכל קובץ
  }, null, 2), "utf8");
  console.log(`\nנשמר: ${outPath}`);
}

main().catch((err) => {
  console.error("stt-benchmark failed:", err);
  process.exitCode = 1;
});
