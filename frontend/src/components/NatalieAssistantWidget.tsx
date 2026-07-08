"use client";

import { Component, FormEvent, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { Mic, SendHorizontal, Volume2, VolumeX, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { apiFetch, API_URL, ApiError, getToken } from "@/lib/api";
import { formatNatalieResponseOrFallback } from "@/lib/natalie/formatResponse";
import { buildBookAppointmentActionFeedback } from "@/lib/natalieBookFeedback";
import { normalizeAvailabilityProposal, normalizeNatalieResponse } from "@/lib/natalie/responseGuard";
import {
  buildVoiceHeardClarificationPrompt,
  parseVoiceClarificationIntent,
  shouldGateVoiceTranscription,
} from "@/lib/natalie/voiceConfidenceGate";
import {
  computeAnalyserRms,
  createInitialChunkVadState,
  createInitialVadTickState,
  evaluateChunkVadTick,
  evaluateVadTick,
  getVadConfig,
  getVadDeviceProfile,
  isIosSafari,
  shouldUseRecorderTimeslice,
  type ChunkVadState,
  type VadConfig,
  type VadTickState,
} from "@/lib/natalie/voiceRecordingVad";
import { logVoiceDebug, shouldLogPeriodicSample } from "@/lib/natalie/voiceRecordingDebug";
import { isUiOverlayOpen, lockUiOverlay, unlockUiOverlay } from "@/lib/ui-overlay";
import { VoiceDebugPanel } from "@/components/VoiceDebugPanel";

type MicState = "idle" | "recording" | "transcribing";

const RECORDER_MIME_CANDIDATES = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"];

const TTS_UNLOCK_SILENT_AUDIO =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";
const NATALIE_SESSION_STORAGE_KEY = "natalie.conversationSessionId";

function readConversationSessionId(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(NATALIE_SESSION_STORAGE_KEY);
}

function persistConversationSessionId(sessionId: string) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(NATALIE_SESSION_STORAGE_KEY, sessionId);
}

function NatalieIdentityAvatar({
  sizeClass,
  roundedClass = "rounded-full",
}: {
  sizeClass: string;
  roundedClass?: string;
}) {
  return (
    <span
      className={`relative block shrink-0 overflow-hidden ${sizeClass} ${roundedClass}`}
      style={{
        backgroundColor: "#E0E7FF",
        backgroundImage: "url(/natalie-portrait.png)",
        backgroundPosition: "center top",
        backgroundSize: "cover",
        border: "1px solid #dbe5ff",
      }}
      aria-hidden
    />
  );
}

function pickRecorderMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const candidate of RECORDER_MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return "";
}

function extensionForRecordingMimeType(mimeType: string): string {
  const base = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (base === "audio/mp4") return "m4a";
  if (base === "audio/webm") return "webm";
  if (base === "audio/mpeg") return "mp3";
  if (base === "audio/ogg") return "ogg";
  return "audio";
}

function releaseMediaStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

function createBrowserAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioContextCtor =
    window.AudioContext ||
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return null;
  try {
    return new AudioContextCtor();
  } catch {
    return null;
  }
}

function isMicRecordingSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof MediaRecorder !== "undefined"
  );
}

function isVadSupported(): boolean {
  return createBrowserAudioContext() !== null;
}

type NatalieInvoiceSummary = {
  id: string;
  supplierName: string | null;
  invoiceNumber: string | null;
  amount: number;
  currency: string;
  issueDate: string | Date;
  dueDate: string | Date | null;
  status: string;
  driveUrl: string | null;
};

type WidgetMessage = {
  id: string;
  sender: "natalie" | "user";
  text: string;
  action?: "create_task" | "complete_task" | "show_invoice" | "issue_invoice" | "book_appointment" | "cancel_appointment" | "reschedule_appointment" | "suggest_available_times";
  proposal?: TaskActionProposal | IssueInvoiceProposal | BookAppointmentProposal | CancelAppointmentProposal | RescheduleAppointmentProposal | SuggestAvailableTimesProposal;
  invoices?: NatalieInvoiceSummary[];
  actionStatus?: "pending" | "creating" | "created" | "cancelled" | "error";
  actionFeedback?: string;
  linkedAvailabilityMessageId?: string;
  selectedBookProposal?: BookAppointmentProposal;
};

type CreateTaskProposal = {
  title: string;
  dueDate?: string;
  notes?: string;
};

type CompleteTaskProposal = {
  taskId: string;
  title: string;
};

type TaskActionProposal = CreateTaskProposal | CompleteTaskProposal;

type IssueInvoiceProposal = {
  customerName: string;
  customerEmail?: string;
  customerTaxId?: string;
  description: string;
  amount: number;
  currency?: string;
  issueDate?: string;
  dueDate?: string;
};

type BookAppointmentProposal = {
  clientName: string;
  startTime?: string;
  dayReference?: string;
  time?: string;
  durationMinutes?: number;
  serviceName?: string;
  notes?: string;
};

type AvailabilitySlot = {
  startTime: string;
  endTime: string;
  label: string;
  durationMinutes: number;
};

type SuggestAvailableTimesProposal = {
  slots: AvailabilitySlot[];
  durationMinutes: number;
  rangeType?: "day" | "week";
  dayReference?: string;
  clientName?: string;
  intent: "suggest" | "first_available" | "check_alternatives";
  refreshParams: {
    rangeType?: "day" | "week";
    dayReference?: string;
    durationMinutes?: number;
    limit?: number;
  };
};

type PendingAvailabilityBooking = {
  slot: AvailabilitySlot;
  serviceName?: string;
};

type CancelAppointmentProposal = {
  appointmentId: string;
  clientName: string;
  when?: string;
  serviceName?: string;
};

type RescheduleAppointmentProposal = {
  appointmentId: string;
  clientName: string;
  newDayReference?: string;
  newTime?: string;
  newWhen?: string;
};

type NatalieAskResponse =
  | { answer: string }
  | {
      action: "create_task";
      proposal: CreateTaskProposal;
      answer: string;
    }
  | {
      action: "complete_task";
      proposal: CompleteTaskProposal;
      answer: string;
    }
  | {
      action: "show_invoice";
      invoices: NatalieInvoiceSummary[];
      answer: string;
    }
  | {
      action: "issue_invoice";
      proposal: IssueInvoiceProposal;
      answer: string;
    }
  | {
      action: "book_appointment";
      proposal: BookAppointmentProposal;
      answer: string;
    }
  | {
      action: "cancel_appointment";
      proposal: CancelAppointmentProposal;
      answer: string;
    }
  | {
      action: "reschedule_appointment";
      proposal: RescheduleAppointmentProposal;
      answer: string;
    }
  | {
      action: "suggest_available_times";
      proposal: SuggestAvailableTimesProposal;
      answer: string;
    };

type NatalieHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

type VoiceTranscriptionResponse = {
  text?: string;
  confidence?: number;
  confidenceLevel?: "high" | "medium" | "low";
  clarificationRequired?: boolean;
  actionBlocked?: boolean;
};

const initialMessages: WidgetMessage[] = [
  {
    id: "welcome",
    sender: "natalie",
    text: "שלום, אני נטלי — עובדת המשרד שלך. כבר עברתי על הדברים החשובים של היום, ואפשר להמשיך יחד מפה.",
  },
  {
    id: "welcome-mic-tip",
    sender: "natalie",
    text: "טיפ קטן: בפעם הראשונה שתלחצו על המיקרופון 🎤, הטלפון יבקש רשות להשתמש בו — פשוט אשרו, וזהו.",
  },
  {
    id: "example-user",
    sender: "user",
    text: "מה דחוף היום?",
  },
  {
    id: "example-natalie",
    sender: "natalie",
    text: "יש חשבונית אחת שמחכה לאישור, ושתי משימות לקוח פתוחות להמשך טיפול.",
  },
];

const hiddenPrefixes = [
  "/login",
  "/signup",
  "/terms",
  "/privacy",
  "/privacy-policy",
  "/cookies",
  "/security",
  "/about",
  "/contact",
  "/status",
  "/data-deletion",
  "/company",
  "/auth",
  "/social/approve",
];

function shouldShowWidget(pathname: string) {
  if (pathname === "/" || pathname === "/natalie") return false;
  return !hiddenPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function buildNatalieHistory(messages: WidgetMessage[]): NatalieHistoryMessage[] {
  return messages
    .filter((message) => message.text !== "נטלי בודקת עבורך..." && message.text !== "מצטערת, לא הצלחתי להתחבר כרגע. נסה שוב.")
    .map<NatalieHistoryMessage>((message) => ({
      role: message.sender === "user" ? "user" : "assistant",
      content: message.text,
    }))
    .slice(-10);
}

function isTaskActionResponse(response: NatalieAskResponse): response is Extract<NatalieAskResponse, { action: "create_task" | "complete_task" }> {
  return "action" in response && (response.action === "create_task" || response.action === "complete_task");
}

function isShowInvoiceResponse(response: NatalieAskResponse): response is Extract<NatalieAskResponse, { action: "show_invoice" }> {
  return (
    "action" in response &&
    response.action === "show_invoice" &&
    Array.isArray((response as { invoices?: unknown }).invoices)
  );
}

function isIssueInvoiceResponse(response: NatalieAskResponse): response is Extract<NatalieAskResponse, { action: "issue_invoice" }> {
  return "action" in response && response.action === "issue_invoice";
}

function isBookAppointmentResponse(response: NatalieAskResponse): response is Extract<NatalieAskResponse, { action: "book_appointment" }> {
  return (
    "action" in response &&
    response.action === "book_appointment" &&
    Boolean((response as { proposal?: unknown }).proposal) &&
    typeof (response as { proposal?: { clientName?: unknown } }).proposal?.clientName === "string"
  );
}

function isCancelAppointmentResponse(response: NatalieAskResponse): response is Extract<NatalieAskResponse, { action: "cancel_appointment" }> {
  return "action" in response && response.action === "cancel_appointment";
}

function isRescheduleAppointmentResponse(
  response: NatalieAskResponse
): response is Extract<NatalieAskResponse, { action: "reschedule_appointment" }> {
  return "action" in response && response.action === "reschedule_appointment";
}

function isSuggestAvailableTimesResponse(
  response: NatalieAskResponse
): response is Extract<NatalieAskResponse, { action: "suggest_available_times" }> {
  return "action" in response && response.action === "suggest_available_times";
}

function isActionableMessage(
  message: WidgetMessage
): message is WidgetMessage & (
  | { action: "create_task"; proposal: CreateTaskProposal }
  | { action: "complete_task"; proposal: CompleteTaskProposal }
) {
  return (
    ((message.action === "create_task" && Boolean(message.proposal)) ||
      (message.action === "complete_task" &&
        Boolean(message.proposal) &&
        typeof (message.proposal as { taskId?: unknown }).taskId === "string"))
  );
}

function isIssueInvoiceActionableMessage(
  message: WidgetMessage
): message is WidgetMessage & { action: "issue_invoice"; proposal: IssueInvoiceProposal } {
  return message.action === "issue_invoice" && Boolean(message.proposal);
}

function isBookAppointmentActionableMessage(
  message: WidgetMessage
): message is WidgetMessage & { action: "book_appointment"; proposal: BookAppointmentProposal } {
  return message.action === "book_appointment" && Boolean(message.proposal);
}

function isCancelAppointmentActionableMessage(
  message: WidgetMessage
): message is WidgetMessage & { action: "cancel_appointment"; proposal: CancelAppointmentProposal } {
  return message.action === "cancel_appointment" && Boolean(message.proposal);
}

function isRescheduleAppointmentActionableMessage(
  message: WidgetMessage
): message is WidgetMessage & { action: "reschedule_appointment"; proposal: RescheduleAppointmentProposal } {
  return message.action === "reschedule_appointment" && Boolean(message.proposal);
}

function isSuggestAvailableTimesMessage(
  message: WidgetMessage
): message is WidgetMessage & { action: "suggest_available_times"; proposal: SuggestAvailableTimesProposal } {
  return (
    message.action === "suggest_available_times" &&
    Boolean(message.proposal) &&
    Array.isArray((message.proposal as { slots?: unknown }).slots)
  );
}

function formatAppointmentWhenLabel(proposal: BookAppointmentProposal): string {
  if (proposal.startTime?.trim()) {
    return formatAppointmentDateTime(proposal.startTime);
  }
  const day = proposal.dayReference?.trim();
  const time = proposal.time?.trim();
  if (day && time) return `${day} בשעה ${time}`;
  return "—";
}

function isInvoiceMessage(message: WidgetMessage): message is WidgetMessage & { action: "show_invoice"; invoices: NatalieInvoiceSummary[] } {
  return message.action === "show_invoice" && Array.isArray(message.invoices) && message.invoices.length > 0;
}

type NatalieWidgetBoundaryProps = { children: ReactNode };
type NatalieWidgetBoundaryState = { hasError: boolean };

class NatalieWidgetBoundary extends Component<NatalieWidgetBoundaryProps, NatalieWidgetBoundaryState> {
  state: NatalieWidgetBoundaryState = { hasError: false };

  static getDerivedStateFromError(): NatalieWidgetBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo) {
    console.error("[natalie-widget] render crash prevented", {
      error: error instanceof Error ? error.message : String(error),
      componentStack: errorInfo.componentStack,
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <section className="fixed bottom-6 right-4 z-50 max-w-xs rounded-2xl border border-[#e6eaf2] bg-white p-4 text-right shadow-[0_8px_20px_rgba(20,40,90,0.12)]" dir="rtl">
          <p className="text-sm font-semibold text-[#0e1116]">נטלי זמינה חלקית כרגע. אפשר להמשיך לעבוד בדשבורד ולנסות שוב בעוד רגע.</p>
        </section>
      );
    }
    return this.props.children;
  }
}

function formatInvoiceDate(date: string | Date) {
  const parsed = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(parsed.getTime())) return String(date);
  return new Intl.DateTimeFormat("he-IL").format(parsed);
}

function formatIssueInvoiceText(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "—";
}

function formatIssueInvoiceAmount(amount: unknown): string {
  return typeof amount === "number" && Number.isFinite(amount) ? amount.toLocaleString("he-IL") : "—";
}

function formatAppointmentDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(parsed);
}

function buildAppointmentErrorFeedback(payload: {
  error?: string;
  code?: string;
  clients?: Array<{ name?: string }>;
}): string {
  switch (payload.code) {
    case "client_not_found":
      return "לא מצאתי לקוח בשם הזה. אפשר לנסות שם אחר או להוסיף את הלקוח קודם.";
    case "multiple_clients": {
      const names = payload.clients?.map((client) => client.name?.trim()).filter(Boolean).join(", ");
      return names
        ? `נמצאו כמה לקוחות מתאימים — צריך לדייק את השם. אפשרויות: ${names}`
        : "נמצאו כמה לקוחות מתאימים — צריך לדייק את השם.";
    }
    case "time_conflict":
      return "השעה הזו כבר תפוסה. אפשר לבחור זמן אחר.";
    default:
      return payload.error?.trim() || "לא הצלחתי לקבוע את התור, אפשר לנסות שוב.";
  }
}

function buildAppointmentModifyErrorFeedback(payload: {
  error?: string;
  code?: string;
}): string {
  switch (payload.code) {
    case "appointment_not_found":
      return "לא מצאתי את התור הזה. אולי הוא כבר בוטל או נמחק.";
    case "time_conflict":
      return "קיים תור אחר בזמן הזה — נסי שעה אחרת.";
    default:
      return payload.error?.trim() || "לא הצלחתי לבצע את הפעולה, אפשר לנסות שוב.";
  }
}

function createVoiceTurnId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `turn-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function NatalieAssistantWidgetInner() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [micState, setMicState] = useState<MicState>("idle");
  const [speechError, setSpeechError] = useState("");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<WidgetMessage[]>(initialMessages);
  const [sending, setSending] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [pendingVoiceClarificationText, setPendingVoiceClarificationText] = useState<string | null>(null);
  const [pendingAudioPlay, setPendingAudioPlay] = useState(false);
  const [pendingAvailabilityBooking, setPendingAvailabilityBooking] = useState<PendingAvailabilityBooking | null>(null);
  const pendingVoiceTurnRef = useRef<{ turnId: string; text: string } | null>(null);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recorderMimeTypeRef = useRef("audio/webm");
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsAudioObjectUrlRef = useRef<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const vadIntervalRef = useRef<number | null>(null);
  const fallbackStopTimerRef = useRef<number | null>(null);
  const vadConfigRef = useRef<VadConfig>(getVadConfig("desktop"));
  const vadTickStateRef = useRef<VadTickState>(createInitialVadTickState(0));
  const chunkVadStateRef = useRef<ChunkVadState>(createInitialChunkVadState());
  const useChunkVadFallbackRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const transcribeStartedRef = useRef(false);
  const vadDebugTickCountRef = useRef(0);
  const vadDebugHadSpeechRef = useRef(false);
  const vadDebugSilenceStartedAtRef = useRef<number | null>(null);
  const chunkDebugHadSpeechRef = useRef(false);
  const stopAudioRecordingRef = useRef<(trigger?: string) => void>(() => {});

  function stopVadMonitoring() {
    if (vadIntervalRef.current !== null) {
      clearInterval(vadIntervalRef.current);
      vadIntervalRef.current = null;
    }
    if (fallbackStopTimerRef.current !== null) {
      clearTimeout(fallbackStopTimerRef.current);
      fallbackStopTimerRef.current = null;
    }
    try {
      mediaStreamSourceRef.current?.disconnect();
    } catch {
      // Ignore disconnect errors during cleanup.
    }
    mediaStreamSourceRef.current = null;
    analyserRef.current = null;
    vadTickStateRef.current = createInitialVadTickState(0);
    chunkVadStateRef.current = createInitialChunkVadState();
    useChunkVadFallbackRef.current = false;

    const audioContext = audioContextRef.current;
    audioContextRef.current = null;
    if (audioContext && audioContext.state !== "closed") {
      void audioContext.close().catch(() => {
        // Ignore AudioContext close errors during cleanup.
      });
    }
  }

  function getTtsAudioElement(): HTMLAudioElement {
    if (!ttsAudioRef.current) {
      ttsAudioRef.current = new Audio();
    }
    return ttsAudioRef.current;
  }

  function revokeTtsObjectUrl() {
    if (ttsAudioObjectUrlRef.current) {
      URL.revokeObjectURL(ttsAudioObjectUrlRef.current);
      ttsAudioObjectUrlRef.current = null;
    }
  }

  function unlockTtsAudioInUserGesture() {
    try {
      const audio = getTtsAudioElement();
      audio.muted = true;
      audio.src = TTS_UNLOCK_SILENT_AUDIO;
      const playPromise = audio.play();
      if (playPromise !== undefined) {
        void playPromise
          .then(() => {
            audio.pause();
            audio.currentTime = 0;
            audio.muted = false;
            if (audio.src === TTS_UNLOCK_SILENT_AUDIO) {
              audio.removeAttribute("src");
              audio.load();
            }
          })
          .catch(() => {
            audio.muted = false;
          });
      }
    } catch {
      // Ignore unlock errors — tap-to-play fallback remains available.
    }
  }

  function prepareAudioContextInUserGesture(): boolean {
    if (!isVadSupported()) {
      console.warn("[natalie][vad] AudioContext not supported — chunk/max-duration fallback only");
      logVoiceDebug("audio_context_unavailable", { reason: "not_supported" });
      return false;
    }

    try {
      stopVadMonitoring();
      audioContextRef.current = createBrowserAudioContext();
      if (audioContextRef.current) {
        logVoiceDebug("audio_context_created", {
          state: audioContextRef.current.state,
          sampleRate: audioContextRef.current.sampleRate,
        });
      } else {
        logVoiceDebug("audio_context_unavailable", { reason: "create_returned_null" });
      }
      return audioContextRef.current !== null;
    } catch (err) {
      console.warn("[natalie][vad] AudioContext creation failed — chunk/max-duration fallback only", err);
      logVoiceDebug("audio_context_unavailable", {
        reason: "create_failed",
        error: err instanceof Error ? err.message : String(err),
      });
      audioContextRef.current = null;
      return false;
    }
  }

  function scheduleFallbackMaxDurationStop() {
    const config = vadConfigRef.current;
    if (fallbackStopTimerRef.current !== null) {
      clearTimeout(fallbackStopTimerRef.current);
    }
    logVoiceDebug("fallback_max_timer_scheduled", {
      timeoutMs: config.fallbackMaxRecordingMs,
    });
    fallbackStopTimerRef.current = window.setTimeout(() => {
      fallbackStopTimerRef.current = null;
      logVoiceDebug("auto_stop_requested", { trigger: "fallback_max" });
      stopAudioRecordingRef.current("fallback_max");
    }, config.fallbackMaxRecordingMs);
  }

  function handleChunkVad(chunkSize: number) {
    if (!useChunkVadFallbackRef.current) return;
    const now = Date.now();
    const previous = chunkVadStateRef.current;
    const result = evaluateChunkVadTick(chunkSize, now, previous, vadConfigRef.current);
    chunkVadStateRef.current = result.nextState;

    if (!previous.hasDetectedSpeech && result.nextState.hasDetectedSpeech) {
      chunkDebugHadSpeechRef.current = true;
      logVoiceDebug("chunk_speech_detected", {
        chunkSize,
        speechChunkMinBytes: vadConfigRef.current.speechChunkMinBytes,
      });
    }
    if (
      previous.silenceStartedAt === null &&
      result.nextState.silenceStartedAt !== null
    ) {
      logVoiceDebug("chunk_silence_timer_started", {
        chunkSize,
        quietChunkMaxBytes: vadConfigRef.current.quietChunkMaxBytes,
        consecutiveQuietChunks: result.nextState.consecutiveQuietChunks,
      });
    }

    if (result.action === "stop_silence" || result.action === "stop_max_duration") {
      logVoiceDebug("auto_stop_requested", {
        trigger: result.action === "stop_silence" ? "chunk_silence" : "chunk_max_duration",
        chunkSize,
        consecutiveQuietChunks: result.nextState.consecutiveQuietChunks,
      });
      stopVadMonitoring();
      stopAudioRecordingRef.current(result.action === "stop_silence" ? "chunk_silence" : "chunk_max_duration");
    }
  }

  async function startVadMonitoring(stream: MediaStream) {
    const config = vadConfigRef.current;
    vadDebugTickCountRef.current = 0;
    vadDebugHadSpeechRef.current = false;
    vadDebugSilenceStartedAtRef.current = null;
    chunkDebugHadSpeechRef.current = false;
    scheduleFallbackMaxDurationStop();

    const audioContext = audioContextRef.current;
    if (!audioContext || audioContext.state === "closed") {
      console.warn("[natalie][vad] no AudioContext available — using chunk fallback");
      useChunkVadFallbackRef.current = true;
      vadTickStateRef.current = createInitialVadTickState(Date.now());
      chunkVadStateRef.current = createInitialChunkVadState();
      logVoiceDebug("chunk_fallback_enabled", { reason: "no_audio_context" });
      logVoiceDebug("vad_monitoring_started", {
        mode: "chunk_only",
        checkIntervalMs: config.checkIntervalMs,
        recorderTimesliceMs: config.recorderTimesliceMs,
      });
      return;
    }

    if (vadIntervalRef.current !== null) {
      clearInterval(vadIntervalRef.current);
      vadIntervalRef.current = null;
    }
    try {
      mediaStreamSourceRef.current?.disconnect();
    } catch {
      // Ignore disconnect errors when reconnecting VAD.
    }
    mediaStreamSourceRef.current = null;
    analyserRef.current = null;
    useChunkVadFallbackRef.current = false;
    vadTickStateRef.current = createInitialVadTickState(Date.now());
    chunkVadStateRef.current = createInitialChunkVadState();

    if (audioContext.state === "suspended") {
      await audioContext.resume();
      logVoiceDebug("audio_context_resumed", { state: audioContext.state });
    }

    try {
      const source = audioContext.createMediaStreamSource(stream);
      mediaStreamSourceRef.current = source;
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.75;
      source.connect(analyser);
      analyserRef.current = analyser;
      logVoiceDebug("analyser_created", {
        fftSize: analyser.fftSize,
        audioContextState: audioContext.state,
      });
      if (config.recorderTimesliceMs > 0) {
        useChunkVadFallbackRef.current = true;
        logVoiceDebug("chunk_fallback_enabled", { reason: "mobile_parallel" });
      }
    } catch (err) {
      console.warn("[natalie][vad] analyser setup failed — using chunk fallback", err);
      useChunkVadFallbackRef.current = true;
      logVoiceDebug("analyser_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      logVoiceDebug("chunk_fallback_enabled", { reason: "analyser_failed" });
      logVoiceDebug("vad_monitoring_started", {
        mode: "chunk_only",
        checkIntervalMs: config.checkIntervalMs,
        recorderTimesliceMs: config.recorderTimesliceMs,
      });
      return;
    }

    logVoiceDebug("vad_monitoring_started", {
      mode: useChunkVadFallbackRef.current ? "analyser_and_chunk" : "analyser_only",
      checkIntervalMs: config.checkIntervalMs,
      volumeThreshold: config.volumeThreshold,
      silenceDurationMs: config.silenceDurationMs,
      minSpeechMs: config.minSpeechMs,
      recorderTimesliceMs: config.recorderTimesliceMs,
      audioContextState: audioContext.state,
    });

    vadIntervalRef.current = window.setInterval(() => {
      vadDebugTickCountRef.current += 1;
      const currentAnalyser = analyserRef.current;
      const recorder = mediaRecorderRef.current;
      if (!currentAnalyser || !recorder || recorder.state !== "recording") {
        if (shouldLogPeriodicSample(vadDebugTickCountRef.current, 25)) {
          logVoiceDebug("vad_tick_skipped", {
            tick: vadDebugTickCountRef.current,
            hasAnalyser: Boolean(currentAnalyser),
            hasRecorder: Boolean(recorder),
            recorderState: recorder?.state ?? "missing",
          });
        }
        return;
      }

      const now = Date.now();
      const previousState = vadTickStateRef.current;
      const rms = computeAnalyserRms(
        currentAnalyser as {
          fftSize: number;
          getByteTimeDomainData: (data: Uint8Array) => void;
        }
      );
      const result = evaluateVadTick(
        rms,
        now,
        previousState,
        config
      );
      vadTickStateRef.current = result.nextState;

      if (shouldLogPeriodicSample(vadDebugTickCountRef.current, 6)) {
        logVoiceDebug("rms_sample", {
          tick: vadDebugTickCountRef.current,
          rms: Number(rms.toFixed(5)),
          threshold: config.volumeThreshold,
          hasDetectedSpeech: result.nextState.hasDetectedSpeech,
          silenceStartedAt: result.nextState.silenceStartedAt,
        });
      }

      if (!vadDebugHadSpeechRef.current && result.nextState.hasDetectedSpeech) {
        vadDebugHadSpeechRef.current = true;
        logVoiceDebug("speech_detected", {
          tick: vadDebugTickCountRef.current,
          rms: Number(rms.toFixed(5)),
          threshold: config.volumeThreshold,
        });
      }

      if (
        vadDebugSilenceStartedAtRef.current === null &&
        result.nextState.silenceStartedAt !== null
      ) {
        vadDebugSilenceStartedAtRef.current = result.nextState.silenceStartedAt;
        logVoiceDebug("silence_timer_started", {
          tick: vadDebugTickCountRef.current,
          rms: Number(rms.toFixed(5)),
          silenceStartedAt: result.nextState.silenceStartedAt,
        });
      } else if (
        vadDebugSilenceStartedAtRef.current !== null &&
        result.nextState.silenceStartedAt === null
      ) {
        logVoiceDebug("silence_timer_cancelled", {
          tick: vadDebugTickCountRef.current,
          rms: Number(rms.toFixed(5)),
          previousSilenceStartedAt: vadDebugSilenceStartedAtRef.current,
        });
        vadDebugSilenceStartedAtRef.current = null;
      }

      if (result.action === "stop_silence" || result.action === "stop_max_duration") {
        logVoiceDebug("auto_stop_requested", {
          trigger: result.action === "stop_silence" ? "vad_silence" : "vad_max_duration",
          tick: vadDebugTickCountRef.current,
          rms: Number(rms.toFixed(5)),
          silenceDurationMs:
            result.nextState.silenceStartedAt !== null
              ? now - result.nextState.silenceStartedAt
              : null,
        });
        stopVadMonitoring();
        stopAudioRecordingRef.current(
          result.action === "stop_silence" ? "vad_silence" : "vad_max_duration"
        );
      }
    }, config.checkIntervalMs);
  }

  function releaseRecordingResources() {
    stopVadMonitoring();
    stopRequestedRef.current = false;

    const recorder = mediaRecorderRef.current;
    if (recorder) {
      recorder.onstop = null;
      recorder.ondataavailable = null;
      recorder.onerror = null;
      try {
        if (recorder.state !== "inactive") {
          recorder.stop();
        }
      } catch {
        // Ignore cleanup errors from already-ended recording sessions.
      }
    }
    mediaRecorderRef.current = null;
    releaseMediaStream(mediaStreamRef.current);
    mediaStreamRef.current = null;
    recordedChunksRef.current = [];
  }

  useEffect(() => {
    messagesRef.current?.scrollTo({
      top: messagesRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const onOpenAssistant = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail;
      setOpen(true);
      if (detail?.message) {
        setInput(detail.message);
        window.setTimeout(() => inputRef.current?.focus(), 120);
      }
    };
    window.addEventListener("open-natalie-assistant", onOpenAssistant);
    return () => window.removeEventListener("open-natalie-assistant", onOpenAssistant);
  }, []);

  useEffect(() => {
    return () => {
      releaseRecordingResources();
    };
  }, []);

  const [uiOverlayOpen, setUiOverlayOpen] = useState(false);

  useEffect(() => {
    const syncOverlayState = () => setUiOverlayOpen(isUiOverlayOpen());
    syncOverlayState();
    const observer = new MutationObserver(syncOverlayState);
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (micState === "idle") return;
    lockUiOverlay();
    return () => unlockUiOverlay();
  }, [micState]);

  const showFloatingAvatar = !uiOverlayOpen && micState === "idle";

  if (!shouldShowWidget(pathname)) return null;

  async function transcribeRecordedAudio(blob: Blob, mimeType: string) {
    if (transcribeStartedRef.current) {
      logVoiceDebug("transcription_skipped_duplicate", {
        blobSize: blob.size,
        mimeType,
      });
      return;
    }
    transcribeStartedRef.current = true;
    logVoiceDebug("transcription_started", {
      blobSize: blob.size,
      mimeType,
    });

    try {
      const token = getToken();
      const formData = new FormData();
      const extension = extensionForRecordingMimeType(mimeType);
      formData.append("audio", blob, `recording.${extension}`);

      const response = await fetch(`${API_URL}/api/natalie/transcribe`, {
        method: "POST",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: formData,
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || `Transcription failed: ${response.status}`);
      }

      const payload = (await response.json()) as VoiceTranscriptionResponse;
      const text = payload.text?.trim();
      if (!text) {
        throw new Error("Empty transcription");
      }

      if (pendingVoiceClarificationText) {
        const clarificationIntent = parseVoiceClarificationIntent(text);
        if (clarificationIntent === "confirm") {
          const confirmedText = pendingVoiceClarificationText;
          setPendingVoiceClarificationText(null);
          setSpeechError("");
          setInput("");
          if (!sending) {
            void sendVoiceTurn(confirmedText);
          }
          return;
        }

        if (clarificationIntent === "reject") {
          setPendingVoiceClarificationText(null);
          setInput("");
          setMessages((current) => [
            ...current,
            {
              id: `natalie-clarification-cancel-${Date.now()}`,
              sender: "natalie",
              text: "מעולה, לא ביצעתי פעולה. אפשר לנסות שוב בקול או להקליד תיקון.",
            },
          ]);
          return;
        }

        setPendingVoiceClarificationText(text);
        setInput(text);
        setSpeechError("");
        setMessages((current) => [
          ...current,
          {
            id: `natalie-clarification-revised-${Date.now()}`,
            sender: "natalie",
            text: buildVoiceHeardClarificationPrompt(text),
          },
        ]);
        return;
      }

      const gateTriggered = shouldGateVoiceTranscription({
        confidence: payload.confidence,
        clarificationRequired: payload.clarificationRequired,
        actionBlocked: payload.actionBlocked,
      });
      if (gateTriggered) {
        setPendingVoiceClarificationText(text);
        setInput(text);
        setSpeechError("");
        setMessages((current) => [
          ...current,
          {
            id: `natalie-clarification-${Date.now()}`,
            sender: "natalie",
            text: buildVoiceHeardClarificationPrompt(text),
          },
        ]);
        return;
      }

      setInput(text);
      setSpeechError("");
      setPendingVoiceClarificationText(null);
      if (!sending) {
        void sendVoiceTurn(text);
      }
    } catch (err) {
      console.error("[natalie] transcription failed", err);
      setSpeechError(
        err instanceof Error && err.message.includes("Transcription failed")
          ? "לא הצלחתי לתמלל את ההקלטה כרגע. נסה שוב או הקלד."
          : "לא הצלחתי לתמלל את ההקלטה כרגע. נסה שוב או הקלד."
      );
    } finally {
      setMicState("idle");
    }
  }

  async function startAudioRecording() {
    if (micState !== "idle" || sending) return;

    if (!isMicRecordingSupported()) {
      setSpeechError("הדפדפן לא תומך בהקלטת קול כרגע.");
      return;
    }

    setSpeechError("");
    recordedChunksRef.current = [];
    stopRequestedRef.current = false;
    transcribeStartedRef.current = false;

    const deviceProfile = getVadDeviceProfile({
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
      maxTouchPoints: typeof navigator !== "undefined" ? navigator.maxTouchPoints : 0,
      innerWidth: typeof window !== "undefined" ? window.innerWidth : 1024,
    });
    const vadConfig = getVadConfig(deviceProfile);
    vadConfigRef.current = vadConfig;
    logVoiceDebug("session_start", {
      deviceProfile,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
      maxTouchPoints: typeof navigator !== "undefined" ? navigator.maxTouchPoints : 0,
      innerWidth: typeof window !== "undefined" ? window.innerWidth : null,
      vadConfig,
    });

    const vadAvailable = prepareAudioContextInUserGesture();
    unlockTtsAudioInUserGesture();

    try {
      if (vadAvailable && audioContextRef.current) {
        await audioContextRef.current.resume();
        logVoiceDebug("audio_context_resumed", {
          state: audioContextRef.current.state,
          phase: "after_get_user_media",
        });
      }

      const iosDevice =
        typeof navigator !== "undefined" &&
        isIosSafari(navigator.userAgent, navigator.maxTouchPoints);

      const stream = await navigator.mediaDevices.getUserMedia(
        iosDevice
          ? { audio: true }
          : {
              audio: {
                echoCancellation: true,
                noiseSuppression: deviceProfile === "desktop",
                autoGainControl: deviceProfile === "desktop",
                channelCount: 1,
              },
            }
      );
      mediaStreamRef.current = stream;

      const preferredMimeType = pickRecorderMimeType();
      const recorder = preferredMimeType
        ? new MediaRecorder(stream, { mimeType: preferredMimeType })
        : new MediaRecorder(stream);
      const resolvedMimeType = recorder.mimeType || preferredMimeType || "audio/webm";
      recorderMimeTypeRef.current = resolvedMimeType;
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
          logVoiceDebug("chunk_received", {
            chunkSize: event.data.size,
            chunkFallbackEnabled: useChunkVadFallbackRef.current,
            chunkIndex: recordedChunksRef.current.length,
          });
          handleChunkVad(event.data.size);
        }
      };

      recorder.onstop = () => {
        logVoiceDebug("recorder_onstop_fired", {
          chunkCount: recordedChunksRef.current.length,
          transcribeStarted: transcribeStartedRef.current,
          stopRequested: stopRequestedRef.current,
        });
        stopVadMonitoring();
        if (transcribeStartedRef.current) {
          releaseMediaStream(mediaStreamRef.current);
          mediaStreamRef.current = null;
          mediaRecorderRef.current = null;
          recordedChunksRef.current = [];
          return;
        }

        const chunks = recordedChunksRef.current;
        recordedChunksRef.current = [];
        releaseMediaStream(mediaStreamRef.current);
        mediaStreamRef.current = null;
        mediaRecorderRef.current = null;

        const audioBlob = new Blob(chunks, { type: recorderMimeTypeRef.current });
        if (!audioBlob.size) {
          setSpeechError("לא התקבלה הקלטה. נסה שוב.");
          setMicState("idle");
          return;
        }

        void transcribeRecordedAudio(audioBlob, recorderMimeTypeRef.current);
      };

      recorder.onerror = () => {
        setSpeechError("לא הצלחתי להקליט. נסה שוב.");
        releaseRecordingResources();
        setMicState("idle");
      };

      const timeslice = shouldUseRecorderTimeslice(vadConfig);
      if (timeslice) {
        recorder.start(timeslice);
      } else {
        recorder.start();
      }
      logVoiceDebug("media_recorder_started", {
        mimeType: resolvedMimeType,
        timesliceMs: timeslice ?? null,
        recorderState: recorder.state,
        streamTrackCount: stream.getAudioTracks().length,
        streamTrackEnabled: stream.getAudioTracks()[0]?.enabled ?? null,
        streamTrackReadyState: stream.getAudioTracks()[0]?.readyState ?? null,
      });

      await startVadMonitoring(stream);
      setMicState("recording");
    } catch (err) {
      releaseRecordingResources();
      setMicState("idle");
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        setSpeechError("לא ניתנה הרשאת מיקרופון. אפשר לאשר בהגדרות הדפדפן ולנסות שוב, או להקליד לנטלי.");
      } else if (err instanceof DOMException && err.name === "NotFoundError") {
        setSpeechError("לא נמצא מיקרופון במכשיר. אפשר להקליד לנטלי.");
      } else {
        setSpeechError("לא הצלחתי להפעיל הקלטה. נסה שוב או הקלד.");
      }
    }
  }

  function stopAudioRecording(trigger = "manual") {
    logVoiceDebug("stop_requested", {
      trigger,
      stopAlreadyRequested: stopRequestedRef.current,
      recorderState: mediaRecorderRef.current?.state ?? "missing",
      micState,
    });
    if (stopRequestedRef.current) return;
    stopRequestedRef.current = true;
    stopVadMonitoring();

    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== "recording") {
      logVoiceDebug("recorder_stop_called", {
        trigger,
        skipped: true,
        reason: !recorder ? "no_recorder" : `recorder_state_${recorder.state}`,
      });
      if (micState === "recording") {
        releaseRecordingResources();
        setMicState("idle");
      }
      return;
    }

    setMicState("transcribing");
    try {
      logVoiceDebug("recorder_stop_called", {
        trigger,
        skipped: false,
        recorderState: recorder.state,
      });
      recorder.stop();
    } catch (err) {
      logVoiceDebug("recorder_stop_called", {
        trigger,
        skipped: false,
        failed: true,
        error: err instanceof Error ? err.message : String(err),
      });
      releaseRecordingResources();
      setMicState("idle");
      setSpeechError("לא הצלחתי לעצור את ההקלטה. נסה שוב.");
    }
  }

  stopAudioRecordingRef.current = stopAudioRecording;

  function handleMicClick() {
    if (micState === "recording") {
      stopAudioRecording();
      return;
    }
    if (micState === "transcribing") return;
    void startAudioRecording();
  }

  function speakWithBrowser(cleanText: string) {
    try {
      if (typeof window === "undefined" || !("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") return;

      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(cleanText);
      u.lang = "he-IL";
      window.speechSynthesis.speak(u);
    } catch (err) {
      console.error("[natalie] speech synthesis failed", err);
    }
  }

  function releaseCurrentAudio() {
    const audio = ttsAudioRef.current;
    if (audio) {
      audio.pause();
      audio.onended = null;
      revokeTtsObjectUrl();
      audio.removeAttribute("src");
      audio.load();
    }
    setPendingAudioPlay(false);
  }

  async function playPendingAudio() {
    const audio = ttsAudioRef.current;
    if (!audio?.src) {
      setPendingAudioPlay(false);
      return;
    }

    try {
      await audio.play();
      setPendingAudioPlay(false);
    } catch (err) {
      console.error("[natalie] audio playback blocked", err);
    }
  }

  async function speakNatalieReply(text: string) {
    const cleanText = text.trim();
    if (!voiceEnabled || !cleanText || cleanText === "נטלי בודקת עבורך...") return;

    releaseCurrentAudio();

    try {
      const token = getToken();
      const response = await fetch(`${API_URL}/api/natalie/voice`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ text: cleanText }),
      });

      if (!response.ok) {
        throw new Error(`Natalie voice failed: ${response.status}`);
      }

      const blob = await response.blob();
      const audio = getTtsAudioElement();
      revokeTtsObjectUrl();
      const objectUrl = URL.createObjectURL(blob);
      ttsAudioObjectUrlRef.current = objectUrl;
      audio.src = objectUrl;
      audio.onended = () => {
        revokeTtsObjectUrl();
        setPendingAudioPlay(false);
      };

      try {
        await audio.play();
        setPendingAudioPlay(false);
      } catch (err) {
        console.error("[natalie] audio playback blocked", err);
        setPendingAudioPlay(true);
      }
    } catch (err) {
      console.error("[natalie] server voice failed, falling back to browser", err);
      releaseCurrentAudio();
      speakWithBrowser(cleanText);
    }
  }

  function stopCurrentSpeech() {
    releaseCurrentAudio();
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  }

  async function sendMessage(text = input) {
    const cleanText = text.trim();
    if (!cleanText || sending) return;

    if (pendingVoiceClarificationText) {
      const clarificationIntent = parseVoiceClarificationIntent(cleanText);
      if (clarificationIntent === "confirm") {
        const confirmedText = pendingVoiceClarificationText;
        setPendingVoiceClarificationText(null);
        setInput("");
        if (!sending) {
          void sendVoiceTurn(confirmedText);
        }
        return;
      }
      if (clarificationIntent === "reject") {
        setPendingVoiceClarificationText(null);
        setInput("");
        setMessages((current) => [
          ...current,
          {
            id: `natalie-clarification-cancel-${Date.now()}`,
            sender: "natalie",
            text: "מעולה, לא ביצעתי פעולה. אפשר לנסות שוב בקול או להקליד תיקון.",
          },
        ]);
        return;
      }
      setPendingVoiceClarificationText(cleanText);
      setInput(cleanText);
      setMessages((current) => [
        ...current,
        {
          id: `natalie-clarification-revised-${Date.now()}`,
          sender: "natalie",
          text: buildVoiceHeardClarificationPrompt(cleanText),
        },
      ]);
      return;
    }

    if (pendingAvailabilityBooking) {
      const timestamp = Date.now();
      const booking = pendingAvailabilityBooking;
      setPendingAvailabilityBooking(null);
      const userMessage: WidgetMessage = {
        id: `user-${timestamp}`,
        sender: "user",
        text: cleanText,
      };
      const bookMessage: WidgetMessage = {
        id: `natalie-book-${timestamp}`,
        sender: "natalie",
        text: `אציע לקבוע תור ל${cleanText} ב${booking.slot.label}. לאשר?`,
        action: "book_appointment",
        proposal: {
          clientName: cleanText,
          startTime: booking.slot.startTime,
          durationMinutes: booking.slot.durationMinutes,
          serviceName: booking.serviceName,
        },
        actionStatus: "pending",
      };
      setMessages((current) => [...current, userMessage, bookMessage]);
      setInput("");
      return;
    }

    const timestamp = Date.now();
    const history = buildNatalieHistory(messages);
    const userMessage: WidgetMessage = {
      id: `user-${timestamp}`,
      sender: "user",
      text: cleanText,
    };

    const loadingMessage: WidgetMessage = {
      id: `natalie-loading-${timestamp}`,
      sender: "natalie",
      text: "נטלי בודקת עבורך...",
    };

    setMessages((current) => [...current, userMessage, loadingMessage]);
    setInput("");
    setSending(true);

    if (voiceEnabled && typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined") {
      const unlock = new SpeechSynthesisUtterance(" ");
      unlock.volume = 0;
      unlock.lang = "he-IL";
      window.speechSynthesis.speak(unlock);
    }

    let result: unknown;
    try {
      result = await apiFetch<unknown>("/api/natalie/ask", {
        method: "POST",
        body: JSON.stringify({
          question: cleanText,
          history,
          sessionId: readConversationSessionId(),
        }),
      });
    } catch (err) {
      console.error("[natalie] ask network failed", err);
      setMessages((current) =>
        current.map((message) =>
          message.id === loadingMessage.id
            ? { ...message, text: "מצטערת, לא הצלחתי להתחבר כרגע. נסה שוב." }
            : message
        )
      );
      setSending(false);
      return;
    }

    try {
      const normalized = normalizeNatalieResponse(result) as NatalieAskResponse;
      if (
        result &&
        typeof result === "object" &&
        typeof (result as { conversationSessionId?: unknown }).conversationSessionId === "string"
      ) {
        persistConversationSessionId((result as { conversationSessionId: string }).conversationSessionId);
      }
      const answer = formatNatalieResponseOrFallback(normalized.answer);
      void speakNatalieReply(answer);
      setMessages((current) =>
        current.map((message) =>
          message.id === loadingMessage.id
            ? {
                ...message,
                text: answer,
                ...(isTaskActionResponse(normalized)
                  ? {
                      action: normalized.action,
                      proposal: normalized.proposal,
                      actionStatus: "pending" as const,
                    }
                  : {}),
                ...(isIssueInvoiceResponse(normalized)
                  ? {
                      action: normalized.action,
                      proposal: normalized.proposal,
                      actionStatus: "pending" as const,
                    }
                  : {}),
                ...(isBookAppointmentResponse(normalized)
                  ? {
                      action: normalized.action,
                      proposal: normalized.proposal,
                      actionStatus: "pending" as const,
                    }
                  : {}),
                ...(isCancelAppointmentResponse(normalized)
                  ? {
                      action: normalized.action,
                      proposal: normalized.proposal,
                      actionStatus: "pending" as const,
                    }
                  : {}),
                ...(isRescheduleAppointmentResponse(normalized)
                  ? {
                      action: normalized.action,
                      proposal: normalized.proposal,
                      actionStatus: "pending" as const,
                    }
                  : {}),
                ...(isSuggestAvailableTimesResponse(normalized)
                  ? {
                      action: normalized.action,
                      proposal: normalizeAvailabilityProposal(normalized.proposal) as SuggestAvailableTimesProposal,
                      actionStatus: "pending" as const,
                    }
                  : {}),
                ...(isShowInvoiceResponse(normalized)
                  ? {
                      action: normalized.action,
                      invoices: normalized.invoices as NatalieInvoiceSummary[],
                    }
                  : {}),
              }
            : message
        )
      );
    } catch (err) {
      console.error("[natalie] ask response processing failed", err);
      const fallbackAnswer = "קיבלתי תשובה חלקית מנטלי. אפשר לנסות שוב.";
      setMessages((current) =>
        current.map((message) =>
          message.id === loadingMessage.id ? { ...message, text: fallbackAnswer } : message
        )
      );
    } finally {
      setSending(false);
    }
  }

  async function sendVoiceTurn(text: string, options?: { retryTurnId?: string }) {
    const cleanText = text.trim();
    if (!cleanText || sending) return;
    setPendingVoiceClarificationText(null);

    const turnId = options?.retryTurnId ?? createVoiceTurnId();
    pendingVoiceTurnRef.current = { turnId, text: cleanText };

    const timestamp = Date.now();
    const history = buildNatalieHistory(messages);
    const userMessage: WidgetMessage = {
      id: `user-${timestamp}`,
      sender: "user",
      text: cleanText,
    };
    const loadingMessage: WidgetMessage = {
      id: `natalie-loading-${timestamp}`,
      sender: "natalie",
      text: "נטלי בודקת עבורך...",
    };

    setMessages((current) => [...current, userMessage, loadingMessage]);
    setInput("");
    setSending(true);

    if (voiceEnabled && typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined") {
      const unlock = new SpeechSynthesisUtterance(" ");
      unlock.volume = 0;
      unlock.lang = "he-IL";
      window.speechSynthesis.speak(unlock);
    }

    let result: unknown;
    let networkAttempt = 0;
    while (networkAttempt < 2) {
      try {
        result = await apiFetch<unknown>("/api/natalie/voice/turn", {
          method: "POST",
          headers: {
            "X-Request-Id": turnId,
          },
          body: JSON.stringify({
            transcript: cleanText,
            history,
            sessionId: readConversationSessionId(),
            turnId,
          }),
        });
        pendingVoiceTurnRef.current = null;
        break;
      } catch (err) {
        networkAttempt += 1;
        const retryable = err instanceof ApiError && err.status === 0 && networkAttempt < 2;
        if (!retryable) {
          console.error("[natalie] voice turn network failed", err);
          setMessages((current) =>
            current.map((message) =>
              message.id === loadingMessage.id
                ? { ...message, text: "מצטערת, לא הצלחתי להתחבר כרגע. נסה שוב." }
                : message
            )
          );
          setSending(false);
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1200));
      }
    }

    try {
      const normalized = normalizeNatalieResponse(result) as NatalieAskResponse;
      if (
        result &&
        typeof result === "object" &&
        typeof (result as { conversationSessionId?: unknown }).conversationSessionId === "string"
      ) {
        persistConversationSessionId((result as { conversationSessionId: string }).conversationSessionId);
      }
      const answer = formatNatalieResponseOrFallback(normalized.answer);
      const spoken =
        result &&
        typeof result === "object" &&
        typeof (result as { spokenResponse?: unknown }).spokenResponse === "string" &&
        (result as { spokenResponse: string }).spokenResponse.trim()
          ? (result as { spokenResponse: string }).spokenResponse
          : answer;
      const executed =
        result &&
        typeof result === "object" &&
        (result as { executed?: unknown }).executed === true;
      void speakNatalieReply(spoken);
      setMessages((current) =>
        current.map((message) =>
          message.id === loadingMessage.id
            ? {
                ...message,
                text: answer,
                ...(executed ? { actionStatus: "created" as const, actionFeedback: answer } : {}),
                ...(!executed && isTaskActionResponse(normalized)
                  ? {
                      action: normalized.action,
                      proposal: normalized.proposal,
                      actionStatus: "pending" as const,
                    }
                  : {}),
                ...(!executed && isIssueInvoiceResponse(normalized)
                  ? {
                      action: normalized.action,
                      proposal: normalized.proposal,
                      actionStatus: "pending" as const,
                    }
                  : {}),
                ...(!executed && isBookAppointmentResponse(normalized)
                  ? {
                      action: normalized.action,
                      proposal: normalized.proposal,
                      actionStatus: "pending" as const,
                    }
                  : {}),
                ...(!executed && isCancelAppointmentResponse(normalized)
                  ? {
                      action: normalized.action,
                      proposal: normalized.proposal,
                      actionStatus: "pending" as const,
                    }
                  : {}),
                ...(!executed && isRescheduleAppointmentResponse(normalized)
                  ? {
                      action: normalized.action,
                      proposal: normalized.proposal,
                      actionStatus: "pending" as const,
                    }
                  : {}),
                ...(!executed && isSuggestAvailableTimesResponse(normalized)
                  ? {
                      action: normalized.action,
                      proposal: normalizeAvailabilityProposal(normalized.proposal) as SuggestAvailableTimesProposal,
                      actionStatus: "pending" as const,
                    }
                  : {}),
                ...(!executed && isShowInvoiceResponse(normalized)
                  ? {
                      action: normalized.action,
                      invoices: normalized.invoices as NatalieInvoiceSummary[],
                    }
                  : {}),
              }
            : message
        )
      );
    } catch (err) {
      console.error("[natalie] voice turn response processing failed", err);
      const fallbackAnswer = "קיבלתי תשובה חלקית מנטלי. אפשר לנסות שוב.";
      setMessages((current) =>
        current.map((message) =>
          message.id === loadingMessage.id ? { ...message, text: fallbackAnswer } : message
        )
      );
    } finally {
      setSending(false);
    }
  }

  async function approveTaskProposal(messageId: string, action: "create_task" | "complete_task", proposal: TaskActionProposal) {
    setMessages((current) =>
      current.map((message) =>
        message.id === messageId ? { ...message, actionStatus: "creating", actionFeedback: undefined } : message
      )
    );

    try {
      if (action === "create_task") {
        await apiFetch<{ id: string; title: string; dueDate: string | null; status: string }>("/api/natalie/create-task", {
          method: "POST",
          body: JSON.stringify(proposal),
        });
      } else {
        await apiFetch<{ id: string; title: string; dueDate: string | null; status: string }>("/api/natalie/complete-task", {
          method: "POST",
          body: JSON.stringify({ taskId: (proposal as CompleteTaskProposal).taskId }),
        });
      }
      setMessages((current) =>
        current.map((message) =>
          message.id === messageId
            ? {
                ...message,
                actionStatus: "created",
                actionFeedback:
                  action === "create_task"
                    ? `✅ המשימה נוצרה: ${proposal.title}`
                    : `✅ המשימה סומנה כבוצעה: ${proposal.title}`,
              }
            : message
        )
      );
    } catch (err) {
      console.error(`[natalie] ${action} failed`, err);
      setMessages((current) =>
        current.map((message) =>
          message.id === messageId
            ? {
                ...message,
                actionStatus: "error",
                actionFeedback:
                  action === "create_task"
                    ? "לא הצלחתי ליצור את המשימה כרגע. אפשר לנסות שוב."
                    : "לא הצלחתי לסמן את המשימה כבוצעה כרגע. אפשר לנסות שוב.",
              }
            : message
        )
      );
    }
  }

  function cancelTaskProposal(messageId: string) {
    setMessages((current) =>
      current.map((message) =>
        message.id === messageId
          ? {
              ...message,
              actionStatus: "cancelled",
              actionFeedback:
                message.action === "complete_task"
                  ? "בוטל. המשימה לא סומנה כבוצעה."
                  : "בוטל. לא נוצרה משימה.",
            }
          : message
      )
    );
  }

  async function approveIssueInvoiceProposal(messageId: string, proposal: IssueInvoiceProposal) {
    setMessages((current) =>
      current.map((message) =>
        message.id === messageId ? { ...message, actionStatus: "creating", actionFeedback: undefined } : message
      )
    );

    try {
      const result = await apiFetch<{ ok: true; draftId: string; confirmationMessage: string }>("/api/natalie/save-invoice-draft", {
        method: "POST",
        body: JSON.stringify(proposal),
      });
      setMessages((current) =>
        current.map((message) =>
          message.id === messageId
            ? {
                ...message,
                actionStatus: "created",
                actionFeedback: result.confirmationMessage,
              }
            : message
        )
      );
    } catch (err) {
      console.error("[natalie] issue_invoice failed", err);
      setMessages((current) =>
        current.map((message) =>
          message.id === messageId
            ? {
                ...message,
                actionStatus: "error",
                actionFeedback: "לא הצלחתי לשמור את הטיוטה כרגע. אפשר לנסות שוב.",
              }
            : message
        )
      );
    }
  }

  function cancelIssueInvoiceProposal(messageId: string) {
    setMessages((current) =>
      current.map((message) =>
        message.id === messageId
          ? {
              ...message,
              actionStatus: "cancelled",
              actionFeedback: "בוטל. לא נשמרה טיוטת חשבונית.",
            }
          : message
      )
    );
  }

  async function refreshAvailabilitySlots(messageId: string, refreshParams: SuggestAvailableTimesProposal["refreshParams"]) {
    try {
      const refreshed = await apiFetch<{
        slots: AvailabilitySlot[];
        empty: boolean;
        durationMinutes: number;
      }>("/api/appointments/availability/slots", {
        method: "POST",
        body: JSON.stringify(refreshParams),
      });

      setMessages((current) =>
        current.map((message) => {
          if (message.id !== messageId || message.action !== "suggest_available_times" || !message.proposal) {
            return message;
          }
          const proposal = message.proposal as SuggestAvailableTimesProposal;
          if (refreshed.empty) {
            return {
              ...message,
              actionFeedback: "לא נשארו זמנים פנויים בטווח הזה.",
              proposal: { ...proposal, slots: [] },
            };
          }
          return {
            ...message,
            actionFeedback: "עדכנתי את הזמנים הפנויים:",
            proposal: {
              ...proposal,
              slots: refreshed.slots.map((slot) => ({
                ...slot,
                durationMinutes: refreshed.durationMinutes,
              })),
              durationMinutes: refreshed.durationMinutes,
            },
            selectedBookProposal: undefined,
          };
        })
      );
    } catch (err) {
      console.error("[natalie] refresh availability slots failed", err);
    }
  }

  function selectAvailabilitySlot(
    availabilityMessageId: string,
    slot: AvailabilitySlot,
    proposal: SuggestAvailableTimesProposal
  ) {
    if (proposal.clientName?.trim()) {
      setMessages((current) =>
        current.map((message) =>
          message.id === availabilityMessageId
            ? {
                ...message,
                selectedBookProposal: {
                  clientName: proposal.clientName!.trim(),
                  startTime: slot.startTime,
                  durationMinutes: slot.durationMinutes,
                  serviceName: proposal.clientName ? undefined : undefined,
                },
              }
            : message
        )
      );
      return;
    }

    setPendingAvailabilityBooking({
      slot,
    });
    setMessages((current) => [
      ...current,
      {
        id: `natalie-ask-client-${Date.now()}`,
        sender: "natalie",
        text: "למי לקבוע את התור?",
      },
    ]);
  }

  async function approveAppointmentProposal(
    messageId: string,
    proposal: BookAppointmentProposal,
    linkedAvailabilityMessageId?: string
  ) {
    setMessages((current) =>
      current.map((message) =>
        message.id === messageId ? { ...message, actionStatus: "creating", actionFeedback: undefined } : message
      )
    );

    try {
      const token = getToken();
      const response = await fetch(`${API_URL}/api/natalie/create-appointment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(proposal),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
        clients?: Array<{ id: string; name: string; whatsappNumber?: string | null }>;
        pendingApproval?: boolean;
        message?: string;
      };

      if (!response.ok) {
        if (payload.code === "time_conflict" && linkedAvailabilityMessageId) {
          const availabilityMessage = messages.find((message) => message.id === linkedAvailabilityMessageId);
          const refreshParams =
            availabilityMessage?.action === "suggest_available_times"
              ? (availabilityMessage.proposal as SuggestAvailableTimesProposal | undefined)?.refreshParams
              : undefined;
          if (refreshParams) {
            await refreshAvailabilitySlots(linkedAvailabilityMessageId, refreshParams);
          }
        }
        setMessages((current) =>
          current.map((message) =>
            message.id === messageId
              ? {
                  ...message,
                  actionStatus: "error",
                  actionFeedback:
                    payload.code === "time_conflict"
                      ? "השעה הזו כבר נתפסה. עדכנתי זמנים חלופיים — אפשר לבחור שוב."
                      : buildAppointmentErrorFeedback(payload),
                }
              : message
          )
        );
        return;
      }

      const whenLabel = formatAppointmentWhenLabel(proposal);
      const actionFeedback = buildBookAppointmentActionFeedback({
        clientName: proposal.clientName,
        whenLabel,
        pendingApproval: payload.pendingApproval,
        message: payload.message,
      });

      setMessages((current) =>
        current.map((message) =>
          message.id === messageId
            ? {
                ...message,
                actionStatus: "created",
                actionFeedback,
              }
            : message
        )
      );
      window.dispatchEvent(new Event("appointments-changed"));
    } catch (err) {
      console.error("[natalie] book_appointment failed", err);
      setMessages((current) =>
        current.map((message) =>
          message.id === messageId
            ? {
                ...message,
                actionStatus: "error",
                actionFeedback: "לא הצלחתי לקבוע את התור, אפשר לנסות שוב.",
              }
            : message
        )
      );
    }
  }

  function cancelAppointmentProposal(messageId: string) {
    setMessages((current) =>
      current.map((message) =>
        message.id === messageId
          ? {
              ...message,
              actionStatus: "cancelled",
              actionFeedback: "בוטל. לא נקבע תור.",
            }
          : message
      )
    );
  }

  async function approveCancelExistingAppointmentProposal(
    messageId: string,
    proposal: CancelAppointmentProposal
  ) {
    setMessages((current) =>
      current.map((message) =>
        message.id === messageId ? { ...message, actionStatus: "creating", actionFeedback: undefined } : message
      )
    );

    try {
      const token = getToken();
      const response = await fetch(`${API_URL}/api/natalie/cancel-appointment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ appointmentId: proposal.appointmentId }),
      });

      const payload = (await response.json().catch(() => ({}))) as { error?: string; code?: string };

      if (!response.ok) {
        setMessages((current) =>
          current.map((message) =>
            message.id === messageId
              ? {
                  ...message,
                  actionStatus: "error",
                  actionFeedback: buildAppointmentModifyErrorFeedback(payload),
                }
              : message
          )
        );
        return;
      }

      setMessages((current) =>
        current.map((message) =>
          message.id === messageId
            ? {
                ...message,
                actionStatus: "created",
                actionFeedback: `✓ התור של ${proposal.clientName} בוטל.`,
              }
            : message
        )
      );
      window.dispatchEvent(new Event("appointments-changed"));
    } catch (err) {
      console.error("[natalie] cancel_appointment failed", err);
      setMessages((current) =>
        current.map((message) =>
          message.id === messageId
            ? {
                ...message,
                actionStatus: "error",
                actionFeedback: "לא הצלחתי לבטל את התור, אפשר לנסות שוב.",
              }
            : message
        )
      );
    }
  }

  function dismissCancelExistingAppointmentProposal(messageId: string) {
    setMessages((current) =>
      current.map((message) =>
        message.id === messageId
          ? {
              ...message,
              actionStatus: "cancelled",
              actionFeedback: "בסדר, השארתי כמו שהיה.",
            }
          : message
      )
    );
  }

  async function approveRescheduleAppointmentProposal(
    messageId: string,
    proposal: RescheduleAppointmentProposal
  ) {
    setMessages((current) =>
      current.map((message) =>
        message.id === messageId ? { ...message, actionStatus: "creating", actionFeedback: undefined } : message
      )
    );

    try {
      const token = getToken();
      const response = await fetch(`${API_URL}/api/natalie/reschedule-appointment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          appointmentId: proposal.appointmentId,
          newDayReference: proposal.newDayReference,
          newTime: proposal.newTime,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as { error?: string; code?: string };

      if (!response.ok) {
        setMessages((current) =>
          current.map((message) =>
            message.id === messageId
              ? {
                  ...message,
                  actionStatus: "error",
                  actionFeedback: buildAppointmentModifyErrorFeedback(payload),
                }
              : message
          )
        );
        return;
      }

      const whenLabel = proposal.newWhen?.trim() || "המועד החדש";
      setMessages((current) =>
        current.map((message) =>
          message.id === messageId
            ? {
                ...message,
                actionStatus: "created",
                actionFeedback: `✓ התור של ${proposal.clientName} הועבר ל${whenLabel}.`,
              }
            : message
        )
      );
      window.dispatchEvent(new Event("appointments-changed"));
    } catch (err) {
      console.error("[natalie] reschedule_appointment failed", err);
      setMessages((current) =>
        current.map((message) =>
          message.id === messageId
            ? {
                ...message,
                actionStatus: "error",
                actionFeedback: "לא הצלחתי להעביר את התור, אפשר לנסות שוב.",
              }
            : message
        )
      );
    }
  }

  function dismissRescheduleAppointmentProposal(messageId: string) {
    setMessages((current) =>
      current.map((message) =>
        message.id === messageId
          ? {
              ...message,
              actionStatus: "cancelled",
              actionFeedback: "בסדר, השארתי כמו שהיה.",
            }
          : message
      )
    );
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    sendMessage();
  }

  return (
    <>
      {open && (
        <section
          className="fixed bottom-[calc(168px+env(safe-area-inset-bottom,0px))] right-4 z-[100] flex h-[min(480px,calc(100dvh-12rem))] w-[calc(100vw-2rem)] max-w-[360px] flex-col overflow-hidden rounded-[24px] border border-[#e6eaf2] bg-white font-sans text-[#0e1116] shadow-[0_24px_70px_rgba(20,40,90,0.18)] lg:bottom-24 lg:right-[17rem] lg:h-[min(480px,calc(100dvh-7.5rem))]"
          dir="rtl"
          aria-label="שיחה עם נטלי"
        >
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[#e6eaf2] bg-white px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="relative">
                <NatalieIdentityAvatar sizeClass="h-11 w-11" roundedClass="rounded-[16px]" />
                <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white bg-[#1faa59]" />
              </div>
              <div className="min-w-0">
                <div className="text-lg font-extrabold leading-tight">נטלי</div>
                <div className="mt-1 flex items-center gap-2 text-sm font-semibold text-[#6b7686]">
                  <span className="h-2 w-2 rounded-full bg-[#1faa59]" />
                  עובדת המשרד שלך
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  setVoiceEnabled((value) => {
                    if (value) stopCurrentSpeech();
                    return !value;
                  })
                }
                className="grid h-10 w-10 place-items-center rounded-xl border border-[#e6eaf2] bg-[#f4f6fb] text-[#6b7686] transition hover:bg-[#e8eeff] hover:text-[#1d5bff]"
                aria-label={voiceEnabled ? "כבה קול לנטלי" : "הפעל קול לנטלי"}
                aria-pressed={voiceEnabled}
              >
                {voiceEnabled ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="grid h-10 w-10 place-items-center rounded-xl border border-[#e6eaf2] bg-[#f4f6fb] text-[#6b7686] transition hover:bg-[#e8eeff] hover:text-[#1d5bff]"
                aria-label="סגור את נטלי"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </header>

          <div ref={messagesRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-[#f4f6fb] px-4 py-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`natalie-message-enter flex ${message.sender === "user" ? "justify-end" : "justify-start"}`}
                dir="ltr"
              >
                <div className="max-w-[86%]" dir="rtl">
                  <div
                    className={
                      message.sender === "user"
                        ? "rounded-[20px] rounded-bl-[6px] bg-[#1d5bff] px-5 py-3.5 text-right text-base font-medium leading-[1.6] text-white shadow-[0_12px_24px_rgba(29,91,255,0.18)]"
                        : "rounded-[20px] rounded-br-[6px] border border-[#e6eaf2] bg-white px-5 py-3.5 text-right text-base font-medium leading-[1.6] text-[#0e1116] shadow-[0_8px_20px_rgba(20,40,90,0.06)]"
                    }
                  >
                    {message.sender === "user" ? message.text : formatNatalieResponseOrFallback(message.text)}
                  </div>
                  {isActionableMessage(message) && (
                    <div className="mt-2 rounded-[16px] border border-[#e6eaf2] bg-white p-3 shadow-[0_8px_20px_rgba(20,40,90,0.06)]">
                      {message.actionFeedback && (
                        <div className="mb-2 text-right text-sm font-bold text-[#0e1116]">{message.actionFeedback}</div>
                      )}
                      {(message.actionStatus === "pending" || message.actionStatus === "creating" || message.actionStatus === "error") && (
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={message.actionStatus === "creating"}
                            onClick={() => approveTaskProposal(message.id, message.action, message.proposal)}
                            className="inline-flex min-h-[56px] items-center justify-center rounded-xl bg-[#1d5bff] px-5 py-3 text-sm font-semibold text-white shadow-[0_10px_22px_rgba(29,91,255,0.22)] transition hover:bg-[#1746c7] disabled:cursor-not-allowed disabled:bg-[#9badf7] disabled:shadow-none"
                          >
                            {message.actionStatus === "creating" ? (message.action === "create_task" ? "יוצרת..." : "מסמנת...") : "אשר ✓"}
                          </button>
                          <button
                            type="button"
                            disabled={message.actionStatus === "creating"}
                            onClick={() => cancelTaskProposal(message.id)}
                            className="inline-flex min-h-[56px] items-center justify-center rounded-xl border border-[#d7def0] bg-white px-5 py-3 text-sm font-semibold text-[#6b7686] transition hover:border-[#1d5bff] hover:bg-[#e8eeff] hover:text-[#1d5bff] disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            ביטול
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  {isIssueInvoiceActionableMessage(message) && (
                    <div className="mt-2 rounded-[16px] border border-[#e6eaf2] bg-white p-3 shadow-[0_8px_20px_rgba(20,40,90,0.06)]">
                      <div className="mb-3 rounded-xl border border-[#f5d565] bg-[#fff8db] px-3 py-2 text-right text-xs font-extrabold leading-6 text-[#8a6400]">
                        ⚠️ טיוטה פנימית — לא חשבונית מס רשמית
                      </div>
                      <div className="mb-3 space-y-1 text-right">
                        <div className="text-sm font-extrabold text-[#0e1116]">לקוח: {formatIssueInvoiceText(message.proposal.customerName)}</div>
                        <div className="text-xs font-bold text-[#6b7686]">תיאור: {formatIssueInvoiceText(message.proposal.description)}</div>
                        <div className="text-xs font-bold text-[#6b7686]">
                          סכום: {formatIssueInvoiceAmount(message.proposal.amount)} {message.proposal.currency ?? "ILS"}
                        </div>
                      </div>
                      {message.actionFeedback && (
                        <div className="mb-2 text-right text-sm font-bold text-[#0e1116]">{message.actionFeedback}</div>
                      )}
                      {(message.actionStatus === "pending" || message.actionStatus === "creating" || message.actionStatus === "error") && (
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={message.actionStatus === "creating"}
                            onClick={() => approveIssueInvoiceProposal(message.id, message.proposal)}
                            className="inline-flex min-h-[56px] items-center justify-center rounded-xl bg-[#1d5bff] px-5 py-3 text-sm font-semibold text-white shadow-[0_10px_22px_rgba(29,91,255,0.22)] transition hover:bg-[#1746c7] disabled:cursor-not-allowed disabled:bg-[#9badf7] disabled:shadow-none"
                          >
                            {message.actionStatus === "creating" ? "שומרת..." : "אשר ✓"}
                          </button>
                          <button
                            type="button"
                            disabled={message.actionStatus === "creating"}
                            onClick={() => cancelIssueInvoiceProposal(message.id)}
                            className="inline-flex min-h-[56px] items-center justify-center rounded-xl border border-[#d7def0] bg-white px-5 py-3 text-sm font-semibold text-[#6b7686] transition hover:border-[#1d5bff] hover:bg-[#e8eeff] hover:text-[#1d5bff] disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            ביטול
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  {isSuggestAvailableTimesMessage(message) && (
                    <div className="mt-2 rounded-[16px] border border-[#e6eaf2] bg-white p-3 shadow-[0_8px_20px_rgba(20,40,90,0.06)]">
                      <div className="mb-3 flex flex-wrap justify-end gap-2" dir="rtl">
                        {message.proposal.slots.map((slot) => (
                          <button
                            key={slot.startTime}
                            type="button"
                            className="inline-flex min-h-[56px] items-center justify-center rounded-full border border-[#d7def0] bg-[#f8faff] px-5 py-3 text-sm font-semibold text-[#0e1116] transition hover:border-[#1d5bff] hover:bg-[#e8eeff] hover:text-[#1d5bff]"
                            onClick={() => selectAvailabilitySlot(message.id, slot, message.proposal)}
                          >
                            {slot.label}
                          </button>
                        ))}
                      </div>
                      {message.actionFeedback && (
                        <div className="mb-2 text-right text-sm font-bold text-[#0e1116]">{message.actionFeedback}</div>
                      )}
                      {message.selectedBookProposal && (
                        <div className="mt-3 rounded-xl border border-[#e6eaf2] bg-[#f8faff] p-3 text-right">
                          <div className="mb-2 text-sm font-extrabold text-[#0e1116]">
                            לקוח: {formatIssueInvoiceText(message.selectedBookProposal.clientName)}
                          </div>
                          <div className="mb-3 text-xs font-bold text-[#6b7686]">
                            מתי: {formatAppointmentWhenLabel(message.selectedBookProposal)}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              className="inline-flex min-h-[56px] items-center justify-center rounded-xl bg-[#1d5bff] px-5 py-3 text-sm font-semibold text-white shadow-[0_10px_22px_rgba(29,91,255,0.22)] transition hover:bg-[#1746c7]"
                              onClick={() => {
                                const bookMessageId = `${message.id}-book`;
                                setMessages((current) => {
                                  const existing = current.find((item) => item.id === bookMessageId);
                                  if (existing) {
                                    return current.map((item) =>
                                      item.id === bookMessageId
                                        ? {
                                            ...item,
                                            proposal: message.selectedBookProposal,
                                            actionStatus: "pending" as const,
                                            actionFeedback: undefined,
                                            linkedAvailabilityMessageId: message.id,
                                          }
                                        : item
                                    );
                                  }
                                  return [
                                    ...current,
                                    {
                                      id: bookMessageId,
                                      sender: "natalie",
                                      text: `אציע לקבוע תור ל${message.selectedBookProposal!.clientName} ב${formatAppointmentWhenLabel(message.selectedBookProposal!)}. לאשר?`,
                                      action: "book_appointment",
                                      proposal: message.selectedBookProposal!,
                                      actionStatus: "pending",
                                      linkedAvailabilityMessageId: message.id,
                                    },
                                  ];
                                });
                              }}
                            >
                              אשר וקבע תור
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  {isBookAppointmentActionableMessage(message) && (
                    <div className="mt-2 rounded-[16px] border border-[#e6eaf2] bg-white p-3 shadow-[0_8px_20px_rgba(20,40,90,0.06)]">
                      <div className="mb-3 space-y-1 text-right">
                        <div className="text-sm font-extrabold text-[#0e1116]">לקוח: {formatIssueInvoiceText(message.proposal.clientName)}</div>
                        <div className="text-xs font-bold text-[#6b7686]">
                          מתי: {formatAppointmentWhenLabel(message.proposal)}
                        </div>
                        {message.proposal.serviceName?.trim() && (
                          <div className="text-xs font-bold text-[#6b7686]">
                            שירות: {formatIssueInvoiceText(message.proposal.serviceName)}
                          </div>
                        )}
                        {typeof message.proposal.durationMinutes === "number" && Number.isFinite(message.proposal.durationMinutes) && (
                          <div className="text-xs font-bold text-[#6b7686]">
                            משך: {message.proposal.durationMinutes} דקות
                          </div>
                        )}
                      </div>
                      {message.actionFeedback && (
                        <div className="mb-2 text-right text-sm font-bold text-[#0e1116]">{message.actionFeedback}</div>
                      )}
                      {(message.actionStatus === "pending" || message.actionStatus === "creating" || message.actionStatus === "error") && (
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={message.actionStatus === "creating"}
                            onClick={() =>
                              approveAppointmentProposal(
                                message.id,
                                message.proposal,
                                message.linkedAvailabilityMessageId
                              )
                            }
                            className="inline-flex min-h-[56px] items-center justify-center rounded-xl bg-[#1d5bff] px-5 py-3 text-sm font-semibold text-white shadow-[0_10px_22px_rgba(29,91,255,0.22)] transition hover:bg-[#1746c7] disabled:cursor-not-allowed disabled:bg-[#9badf7] disabled:shadow-none"
                          >
                            {message.actionStatus === "creating" ? "קובע תור..." : "אשר וקבע תור"}
                          </button>
                          <button
                            type="button"
                            disabled={message.actionStatus === "creating"}
                            onClick={() => cancelAppointmentProposal(message.id)}
                            className="inline-flex min-h-[56px] items-center justify-center rounded-xl border border-[#d7def0] bg-white px-5 py-3 text-sm font-semibold text-[#6b7686] transition hover:border-[#1d5bff] hover:bg-[#e8eeff] hover:text-[#1d5bff] disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            ביטול
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  {isCancelAppointmentActionableMessage(message) && (
                    <div className="mt-2 rounded-[16px] border border-[#e6eaf2] bg-white p-3 shadow-[0_8px_20px_rgba(20,40,90,0.06)]">
                      <div className="mb-3 space-y-1 text-right">
                        <div className="text-sm font-extrabold text-[#0e1116]">
                          ביטול תור — {formatIssueInvoiceText(message.proposal.clientName)}
                        </div>
                        {message.proposal.when?.trim() && (
                          <div className="text-xs font-bold text-[#6b7686]">
                            מתי: {formatIssueInvoiceText(message.proposal.when)}
                          </div>
                        )}
                        {message.proposal.serviceName?.trim() && (
                          <div className="text-xs font-bold text-[#6b7686]">
                            שירות: {formatIssueInvoiceText(message.proposal.serviceName)}
                          </div>
                        )}
                      </div>
                      {message.actionFeedback && (
                        <div className="mb-2 text-right text-sm font-bold text-[#0e1116]">{message.actionFeedback}</div>
                      )}
                      {(message.actionStatus === "pending" || message.actionStatus === "creating" || message.actionStatus === "error") && (
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={message.actionStatus === "creating"}
                            onClick={() => approveCancelExistingAppointmentProposal(message.id, message.proposal)}
                            className="inline-flex min-h-[56px] items-center justify-center rounded-xl bg-[#dc2626] px-5 py-3 text-sm font-semibold text-white shadow-[0_10px_22px_rgba(220,38,38,0.22)] transition hover:bg-[#b91c1c] disabled:cursor-not-allowed disabled:bg-[#f87171] disabled:shadow-none"
                          >
                            {message.actionStatus === "creating" ? "מבטלת..." : "אשר ביטול"}
                          </button>
                          <button
                            type="button"
                            disabled={message.actionStatus === "creating"}
                            onClick={() => dismissCancelExistingAppointmentProposal(message.id)}
                            className="inline-flex min-h-[56px] items-center justify-center rounded-xl border border-[#d7def0] bg-white px-5 py-3 text-sm font-semibold text-[#6b7686] transition hover:border-[#1d5bff] hover:bg-[#e8eeff] hover:text-[#1d5bff] disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            השאר את התור
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  {isRescheduleAppointmentActionableMessage(message) && (
                    <div className="mt-2 rounded-[16px] border border-[#e6eaf2] bg-white p-3 shadow-[0_8px_20px_rgba(20,40,90,0.06)]">
                      <div className="mb-3 space-y-1 text-right">
                        <div className="text-sm font-extrabold text-[#0e1116]">
                          שינוי מועד — {formatIssueInvoiceText(message.proposal.clientName)}
                        </div>
                        <div className="text-xs font-bold text-[#6b7686]">
                          ל{formatIssueInvoiceText(message.proposal.newWhen)}
                        </div>
                      </div>
                      {message.actionFeedback && (
                        <div className="mb-2 text-right text-sm font-bold text-[#0e1116]">{message.actionFeedback}</div>
                      )}
                      {(message.actionStatus === "pending" || message.actionStatus === "creating" || message.actionStatus === "error") && (
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={message.actionStatus === "creating"}
                            onClick={() => approveRescheduleAppointmentProposal(message.id, message.proposal)}
                            className="inline-flex min-h-[56px] items-center justify-center rounded-xl bg-[#1d5bff] px-5 py-3 text-sm font-semibold text-white shadow-[0_10px_22px_rgba(29,91,255,0.22)] transition hover:bg-[#1746c7] disabled:cursor-not-allowed disabled:bg-[#9badf7] disabled:shadow-none"
                          >
                            {message.actionStatus === "creating" ? "מעבירה..." : "אשר שינוי"}
                          </button>
                          <button
                            type="button"
                            disabled={message.actionStatus === "creating"}
                            onClick={() => dismissRescheduleAppointmentProposal(message.id)}
                            className="inline-flex min-h-[56px] items-center justify-center rounded-xl border border-[#d7def0] bg-white px-5 py-3 text-sm font-semibold text-[#6b7686] transition hover:border-[#1d5bff] hover:bg-[#e8eeff] hover:text-[#1d5bff] disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            בטל
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  {isInvoiceMessage(message) && (
                    <div className="mt-2 rounded-[16px] border border-[#e6eaf2] bg-white p-3 shadow-[0_8px_20px_rgba(20,40,90,0.06)]">
                      <div className="space-y-3 text-right">
                        {message.invoices.map((invoice) => (
                          <div key={invoice.id} className="rounded-xl border border-[#e6eaf2] bg-[#f8faff] p-3">
                            <div className="text-sm font-extrabold text-[#0e1116]">
                              {invoice.supplierName ?? "ספק לא ידוע"}
                              {invoice.invoiceNumber ? ` · ${invoice.invoiceNumber}` : ""}
                            </div>
                            <div className="mt-1 text-xs font-bold text-[#6b7686]">
                              {invoice.amount.toLocaleString("he-IL")} {invoice.currency} · {formatInvoiceDate(invoice.issueDate)}
                            </div>
                            {invoice.driveUrl && (
                              <a
                                href={invoice.driveUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="mt-3 inline-flex min-h-[56px] items-center justify-center rounded-xl bg-[#1d5bff] px-5 py-3 text-sm font-semibold text-white shadow-[0_10px_22px_rgba(29,91,255,0.22)] transition hover:bg-[#1746c7]"
                              >
                                פתחי ב-Drive
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {pendingAudioPlay && voiceEnabled && (
            <div className="shrink-0 border-t border-[#e6eaf2] bg-[#f8faff] px-3 py-2">
              <button
                type="button"
                onClick={() => void playPendingAudio()}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-[#d7def0] bg-white px-3 py-2 text-xs font-extrabold text-[#1d5bff] transition hover:border-[#1d5bff] hover:bg-[#e8eeff]"
                aria-label="הקש כדי לשמוע את תשובת נטלי"
              >
                <Volume2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>▶ הקש כדי לשמוע</span>
              </button>
            </div>
          )}

          <form onSubmit={onSubmit} className="shrink-0 border-t border-[#e6eaf2] bg-white p-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleMicClick}
                disabled={!isMicRecordingSupported() || sending || micState === "transcribing"}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] border border-[#d7def0] bg-white text-[#1d5bff] transition hover:border-[#1d5bff] hover:bg-[#e8eeff]"
                aria-label={micState === "recording" ? "סיים הקלטה" : "התחל הקלטה קולית"}
              >
                <Mic className="h-5 w-5" />
              </button>
              <input
                ref={inputRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                disabled={sending}
                placeholder="כתוב הודעה לנטלי…"
                className="min-h-[56px] flex-1 rounded-[14px] border border-[#e6eaf2] bg-[#f4f6fb] px-4 py-3.5 text-base font-medium text-[#0e1116] outline-none placeholder:text-[#6b7686] focus:border-[#1d5bff] focus:bg-white focus:shadow-[0_0_0_4px_rgba(29,91,255,0.10)]"
                aria-label="הודעה לנטלי"
              />
              <button
                type="submit"
                disabled={!input.trim() || sending}
                className="grid h-14 w-14 shrink-0 place-items-center rounded-[14px] bg-[#1d5bff] text-white shadow-[0_10px_22px_rgba(29,91,255,0.22)] transition hover:bg-[#1746c7] disabled:cursor-not-allowed disabled:bg-[#9badf7] disabled:shadow-none"
                aria-label="שלח הודעה"
              >
                <SendHorizontal className="h-5 w-5 rotate-180" />
              </button>
            </div>
            {speechError && micState === "idle" && (
              <p className="mt-2 text-sm font-bold text-red-600" role="alert">
                {speechError}
              </p>
            )}
          </form>
        </section>
      )}

      {showFloatingAvatar && (
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`group fixed z-50 grid place-items-center rounded-full transition hover:scale-[1.03] focus:outline-none focus:ring-4 lg:bottom-6 lg:right-[17rem] ${
          pathname === "/dashboard"
            ? "bottom-[calc(112px+env(safe-area-inset-bottom,0px))] right-3 h-[5rem] w-[5rem]"
            : "bottom-[calc(96px+env(safe-area-inset-bottom,0px))] right-4 h-[4.25rem] w-[4.25rem]"
        }`}
        style={{
          background: "linear-gradient(135deg, #3a6cff, #1d5bff, #1746c7)",
          boxShadow: "0 18px 40px rgba(29,91,255,0.32), 0 0 0 6px rgba(29,91,255,0.08)",
        }}
        aria-label={open ? "סגור את נטלי" : "פתח את נטלי"}
        aria-expanded={open}
      >
        <span className="absolute inset-0 rounded-full opacity-0 transition group-hover:opacity-100" style={{ boxShadow: "0 0 0 8px rgba(29,91,255,0.12)" }} />
        <span className="relative">
          <NatalieIdentityAvatar sizeClass={pathname === "/dashboard" ? "h-[4.5rem] w-[4.5rem]" : "h-[3.85rem] w-[3.85rem]"} />
          <span className="absolute bottom-0 right-0 h-4 w-4 rounded-full border-2 border-white bg-[#1faa59]" />
        </span>
      </button>
      )}

      {micState !== "idle" && (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-[rgba(15,24,48,0.32)] p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="מצב הקלטה">
          <div className="natalie-message-enter w-full max-w-sm rounded-[28px] border border-[#e6eaf2] bg-white p-8 text-center shadow-[0_30px_90px_rgba(20,40,90,0.22)]" dir="rtl">
            <div className="relative mx-auto mb-6 grid h-36 w-36 place-items-center">
              <span className="absolute h-24 w-24 animate-ping rounded-full bg-[#1d5bff]/15" />
              <span className="absolute h-32 w-32 animate-pulse rounded-full border border-[#1d5bff]/20" />
              <span className="absolute h-36 w-36 animate-pulse rounded-full border border-[#1d5bff]/10" />
              <span className="relative grid h-24 w-24 place-items-center rounded-full bg-[linear-gradient(135deg,#3a6cff,#1d5bff,#1746c7)] text-white shadow-[0_18px_45px_rgba(29,91,255,0.30)]">
                <Mic className="h-10 w-10" />
              </span>
            </div>
            <h2 className="m-0 text-3xl font-extrabold text-[#0e1116]">
              {micState === "transcribing" ? "מתמלל…" : "מקליט… (הפסק לדבר לסיום)"}
            </h2>
            <p className="mx-auto mt-2 max-w-xs text-base font-semibold leading-7 text-[#6b7686]">
              {micState === "transcribing"
                ? "ממירה את ההקלטה לטקסט בעברית."
                : "דבר בעברית, ואני אמלא את ההודעה בשדה הצ׳אט."}
            </p>
            {speechError && micState === "recording" && (
              <p className="mx-auto mt-2 max-w-xs text-sm font-bold text-red-600">{speechError}</p>
            )}
            <button
              type="button"
              onClick={() => stopAudioRecording("manual")}
              disabled={micState === "transcribing"}
              className="mt-6 inline-flex min-h-[56px] items-center justify-center rounded-xl bg-[#1d5bff] px-6 py-2.5 text-base font-extrabold text-white shadow-[0_12px_28px_rgba(29,91,255,0.24)] transition hover:bg-[#1746c7] disabled:cursor-not-allowed disabled:bg-[#9badf7] disabled:shadow-none"
            >
              {micState === "transcribing" ? "מתמלל…" : "עצור"}
            </button>
          </div>
        </div>
      )}

      <VoiceDebugPanel />
    </>
  );
}

export function NatalieAssistantWidget() {
  return (
    <NatalieWidgetBoundary>
      <NatalieAssistantWidgetInner />
    </NatalieWidgetBoundary>
  );
}
