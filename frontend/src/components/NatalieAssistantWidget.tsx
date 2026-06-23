"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Mic, SendHorizontal, Volume2, VolumeX, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { apiFetch, API_URL, getToken } from "@/lib/api";

type MicState = "idle" | "recording" | "transcribing";

const RECORDER_MIME_CANDIDATES = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"];

const VAD_SILENCE_DURATION_MS = 2500;
const VAD_VOLUME_THRESHOLD = 0.015;
const VAD_MIN_SPEECH_MS = 400;
const VAD_MAX_RECORDING_MS = 30000;
const VAD_CHECK_INTERVAL_MS = 100;
const TTS_UNLOCK_SILENT_AUDIO =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

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

function computeAnalyserRms(analyser: AnalyserNode): number {
  const data = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(data);
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const normalized = (data[i]! - 128) / 128;
    sum += normalized * normalized;
  }
  return Math.sqrt(sum / data.length);
}

function isMicRecordingSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof MediaRecorder !== "undefined"
  );
}

function isVadSupported(): boolean {
  return typeof AudioContext !== "undefined";
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

const initialMessages: WidgetMessage[] = [
  {
    id: "welcome",
    sender: "natalie",
    text: "שלום, אני נטלי. אפשר לשאול אותי על חשבוניות, משימות, תשלומים או מה דורש טיפול היום.",
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
  "/privacy-policy",
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
    .filter((message) => message.text !== "נטלי חושבת..." && message.text !== "מצטערת, לא הצלחתי להתחבר כרגע. נסה שוב.")
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
  return "action" in response && response.action === "show_invoice";
}

function isIssueInvoiceResponse(response: NatalieAskResponse): response is Extract<NatalieAskResponse, { action: "issue_invoice" }> {
  return "action" in response && response.action === "issue_invoice";
}

function isBookAppointmentResponse(response: NatalieAskResponse): response is Extract<NatalieAskResponse, { action: "book_appointment" }> {
  return "action" in response && response.action === "book_appointment";
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
      (message.action === "complete_task" && Boolean(message.proposal)))
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
  return message.action === "suggest_available_times" && Boolean(message.proposal);
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

export function NatalieAssistantWidget() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [micState, setMicState] = useState<MicState>("idle");
  const [speechError, setSpeechError] = useState("");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<WidgetMessage[]>(initialMessages);
  const [sending, setSending] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [pendingAudioPlay, setPendingAudioPlay] = useState(false);
  const [pendingAvailabilityBooking, setPendingAvailabilityBooking] = useState<PendingAvailabilityBooking | null>(null);
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
  const silenceStartedAtRef = useRef<number | null>(null);
  const hasDetectedSpeechRef = useRef(false);
  const speechStartedAtRef = useRef<number | null>(null);
  const recordingStartedAtRef = useRef<number | null>(null);
  const stopAudioRecordingRef = useRef<() => void>(() => {});

  function stopVadMonitoring() {
    if (vadIntervalRef.current !== null) {
      clearInterval(vadIntervalRef.current);
      vadIntervalRef.current = null;
    }
    try {
      mediaStreamSourceRef.current?.disconnect();
    } catch {
      // Ignore disconnect errors during cleanup.
    }
    mediaStreamSourceRef.current = null;
    analyserRef.current = null;
    silenceStartedAtRef.current = null;
    hasDetectedSpeechRef.current = false;
    speechStartedAtRef.current = null;
    recordingStartedAtRef.current = null;

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
      console.warn("[natalie][vad] AudioContext not supported — manual stop only");
      return false;
    }

    try {
      stopVadMonitoring();
      audioContextRef.current = new AudioContext();
      return true;
    } catch (err) {
      console.warn("[natalie][vad] AudioContext creation failed — manual stop only", err);
      audioContextRef.current = null;
      return false;
    }
  }

  async function startVadMonitoring(stream: MediaStream) {
    const audioContext = audioContextRef.current;
    if (!audioContext || audioContext.state === "closed") {
      console.warn("[natalie][vad] no AudioContext available — manual stop only");
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
    silenceStartedAtRef.current = null;
    hasDetectedSpeechRef.current = false;
    speechStartedAtRef.current = null;
    recordingStartedAtRef.current = null;

    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    const source = audioContext.createMediaStreamSource(stream);
    mediaStreamSourceRef.current = source;
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.8;
    source.connect(analyser);
    analyserRef.current = analyser;

    recordingStartedAtRef.current = Date.now();
    silenceStartedAtRef.current = null;
    hasDetectedSpeechRef.current = false;
    speechStartedAtRef.current = null;

    vadIntervalRef.current = window.setInterval(() => {
      const currentAnalyser = analyserRef.current;
      const recorder = mediaRecorderRef.current;
      if (!currentAnalyser || !recorder || recorder.state !== "recording") {
        return;
      }

      const now = Date.now();
      const rms = computeAnalyserRms(currentAnalyser);

      if (rms > VAD_VOLUME_THRESHOLD) {
        if (!hasDetectedSpeechRef.current) {
          hasDetectedSpeechRef.current = true;
          speechStartedAtRef.current = now;
        }
        silenceStartedAtRef.current = null;
      } else if (
        hasDetectedSpeechRef.current &&
        speechStartedAtRef.current !== null &&
        now - speechStartedAtRef.current >= VAD_MIN_SPEECH_MS
      ) {
        if (silenceStartedAtRef.current === null) {
          silenceStartedAtRef.current = now;
        } else if (now - silenceStartedAtRef.current >= VAD_SILENCE_DURATION_MS) {
          stopVadMonitoring();
          stopAudioRecordingRef.current();
        }
      }

      if (
        recordingStartedAtRef.current !== null &&
        now - recordingStartedAtRef.current >= VAD_MAX_RECORDING_MS
      ) {
        stopVadMonitoring();
        stopAudioRecordingRef.current();
      }
    }, VAD_CHECK_INTERVAL_MS);
  }

  function releaseRecordingResources() {
    stopVadMonitoring();

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
    return () => {
      releaseRecordingResources();
    };
  }, []);

  if (!shouldShowWidget(pathname)) return null;

  async function transcribeRecordedAudio(blob: Blob, mimeType: string) {
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

      const payload = (await response.json()) as { text?: string };
      const text = payload.text?.trim();
      if (!text) {
        throw new Error("Empty transcription");
      }

      setInput(text);
      setSpeechError("");
      if (!sending) {
        void sendMessage(text);
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

    const vadAvailable = prepareAudioContextInUserGesture();
    unlockTtsAudioInUserGesture();

    try {
      if (vadAvailable && audioContextRef.current) {
        await audioContextRef.current.resume();
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
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
        }
      };

      recorder.onstop = () => {
        stopVadMonitoring();
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

      recorder.start();
      if (vadAvailable) {
        await startVadMonitoring(stream);
      }
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

  function stopAudioRecording() {
    stopVadMonitoring();

    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== "recording") {
      if (micState === "recording") {
        releaseRecordingResources();
        setMicState("idle");
      }
      return;
    }

    setMicState("transcribing");
    try {
      recorder.stop();
    } catch {
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
    if (!voiceEnabled || !cleanText || cleanText === "נטלי חושבת...") return;

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
      text: "נטלי חושבת...",
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

    let result: NatalieAskResponse;
    try {
      result = await apiFetch<NatalieAskResponse>("/api/natalie/ask", {
        method: "POST",
        body: JSON.stringify({ question: cleanText, history }),
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
      const answer = result.answer?.trim() || "לא מצאתי תשובה לפי הנתונים הקיימים כרגע.";
      void speakNatalieReply(answer);
      setMessages((current) =>
        current.map((message) =>
          message.id === loadingMessage.id
            ? {
                ...message,
                text: answer,
                ...(isTaskActionResponse(result)
                  ? {
                      action: result.action,
                      proposal: result.proposal,
                      actionStatus: "pending" as const,
                    }
                  : {}),
                ...(isIssueInvoiceResponse(result)
                  ? {
                      action: result.action,
                      proposal: result.proposal,
                      actionStatus: "pending" as const,
                    }
                  : {}),
                ...(isBookAppointmentResponse(result)
                  ? {
                      action: result.action,
                      proposal: result.proposal,
                      actionStatus: "pending" as const,
                    }
                  : {}),
                ...(isCancelAppointmentResponse(result)
                  ? {
                      action: result.action,
                      proposal: result.proposal,
                      actionStatus: "pending" as const,
                    }
                  : {}),
                ...(isRescheduleAppointmentResponse(result)
                  ? {
                      action: result.action,
                      proposal: result.proposal,
                      actionStatus: "pending" as const,
                    }
                  : {}),
                ...(isSuggestAvailableTimesResponse(result)
                  ? {
                      action: result.action,
                      proposal: result.proposal,
                      actionStatus: "pending" as const,
                    }
                  : {}),
                ...(isShowInvoiceResponse(result)
                  ? {
                      action: result.action,
                      invoices: result.invoices,
                    }
                  : {}),
              }
            : message
        )
      );
    } catch (err) {
      console.error("[natalie] ask response processing failed", err);
      const fallbackAnswer = result.answer?.trim() || "לא מצאתי תשובה לפי הנתונים הקיימים כרגע.";
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

      setMessages((current) =>
        current.map((message) =>
          message.id === messageId
            ? {
                ...message,
                actionStatus: "created",
                actionFeedback: `✓ התור נקבע ל${proposal.clientName} ב${formatAppointmentWhenLabel(proposal)}`,
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
          className="fixed bottom-24 right-4 z-[130] flex h-[min(480px,calc(100dvh-7.5rem))] w-[calc(100vw-2rem)] max-w-[360px] flex-col overflow-hidden rounded-[24px] border border-[#e6eaf2] bg-white font-sans text-[#0e1116] shadow-[0_24px_70px_rgba(20,40,90,0.18)] lg:right-[17rem]"
          dir="rtl"
          aria-label="שיחה עם נטלי"
        >
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[#e6eaf2] bg-white px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-[16px] bg-[linear-gradient(135deg,#3a6cff,#1d5bff,#1746c7)] text-xl font-black text-white shadow-[0_12px_24px_rgba(29,91,255,0.25)]">
                נ
              </div>
              <div className="min-w-0">
                <div className="text-lg font-extrabold leading-tight">נטלי</div>
                <div className="mt-0.5 flex items-center gap-1.5 text-sm font-semibold text-[#6b7686]">
                  <span className="h-2 w-2 rounded-full bg-[#1faa59]" />
                  כאן לעזור
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
                        ? "rounded-[18px] rounded-bl-[5px] bg-[#1d5bff] px-4 py-2.5 text-right text-[15px] font-semibold leading-6 text-white shadow-[0_12px_24px_rgba(29,91,255,0.18)]"
                        : "rounded-[18px] rounded-br-[5px] border border-[#e6eaf2] bg-white px-4 py-2.5 text-right text-[15px] font-semibold leading-6 text-[#0e1116] shadow-[0_8px_20px_rgba(20,40,90,0.06)]"
                    }
                  >
                    {message.text}
                  </div>
                  {isActionableMessage(message) && (
                    <div className="mt-2 rounded-[16px] border border-[#e6eaf2] bg-white p-3 shadow-[0_8px_20px_rgba(20,40,90,0.06)]">
                      {message.actionFeedback && (
                        <div className="mb-2 text-right text-[14px] font-bold text-[#0e1116]">{message.actionFeedback}</div>
                      )}
                      {(message.actionStatus === "pending" || message.actionStatus === "creating" || message.actionStatus === "error") && (
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={message.actionStatus === "creating"}
                            onClick={() => approveTaskProposal(message.id, message.action, message.proposal)}
                            className="inline-flex min-h-10 items-center justify-center rounded-xl bg-[#1d5bff] px-4 py-2 text-sm font-extrabold text-white shadow-[0_10px_22px_rgba(29,91,255,0.22)] transition hover:bg-[#1746c7] disabled:cursor-not-allowed disabled:bg-[#9badf7] disabled:shadow-none"
                          >
                            {message.actionStatus === "creating" ? (message.action === "create_task" ? "יוצרת..." : "מסמנת...") : "אשר ✓"}
                          </button>
                          <button
                            type="button"
                            disabled={message.actionStatus === "creating"}
                            onClick={() => cancelTaskProposal(message.id)}
                            className="inline-flex min-h-10 items-center justify-center rounded-xl border border-[#d7def0] bg-white px-4 py-2 text-sm font-extrabold text-[#6b7686] transition hover:border-[#1d5bff] hover:bg-[#e8eeff] hover:text-[#1d5bff] disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            ביטול
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  {isIssueInvoiceActionableMessage(message) && (
                    <div className="mt-2 rounded-[16px] border border-[#e6eaf2] bg-white p-3 shadow-[0_8px_20px_rgba(20,40,90,0.06)]">
                      <div className="mb-3 rounded-xl border border-[#f5d565] bg-[#fff8db] px-3 py-2 text-right text-[13px] font-extrabold leading-6 text-[#8a6400]">
                        ⚠️ טיוטה פנימית — לא חשבונית מס רשמית
                      </div>
                      <div className="mb-3 space-y-1 text-right">
                        <div className="text-[14px] font-extrabold text-[#0e1116]">לקוח: {formatIssueInvoiceText(message.proposal.customerName)}</div>
                        <div className="text-[13px] font-bold text-[#6b7686]">תיאור: {formatIssueInvoiceText(message.proposal.description)}</div>
                        <div className="text-[13px] font-bold text-[#6b7686]">
                          סכום: {formatIssueInvoiceAmount(message.proposal.amount)} {message.proposal.currency ?? "ILS"}
                        </div>
                      </div>
                      {message.actionFeedback && (
                        <div className="mb-2 text-right text-[14px] font-bold text-[#0e1116]">{message.actionFeedback}</div>
                      )}
                      {(message.actionStatus === "pending" || message.actionStatus === "creating" || message.actionStatus === "error") && (
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={message.actionStatus === "creating"}
                            onClick={() => approveIssueInvoiceProposal(message.id, message.proposal)}
                            className="inline-flex min-h-10 items-center justify-center rounded-xl bg-[#1d5bff] px-4 py-2 text-sm font-extrabold text-white shadow-[0_10px_22px_rgba(29,91,255,0.22)] transition hover:bg-[#1746c7] disabled:cursor-not-allowed disabled:bg-[#9badf7] disabled:shadow-none"
                          >
                            {message.actionStatus === "creating" ? "שומרת..." : "אשר ✓"}
                          </button>
                          <button
                            type="button"
                            disabled={message.actionStatus === "creating"}
                            onClick={() => cancelIssueInvoiceProposal(message.id)}
                            className="inline-flex min-h-10 items-center justify-center rounded-xl border border-[#d7def0] bg-white px-4 py-2 text-sm font-extrabold text-[#6b7686] transition hover:border-[#1d5bff] hover:bg-[#e8eeff] hover:text-[#1d5bff] disabled:cursor-not-allowed disabled:opacity-60"
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
                            className="inline-flex min-h-10 items-center justify-center rounded-full border border-[#d7def0] bg-[#f8faff] px-4 py-2 text-sm font-extrabold text-[#0e1116] transition hover:border-[#1d5bff] hover:bg-[#e8eeff] hover:text-[#1d5bff]"
                            onClick={() => selectAvailabilitySlot(message.id, slot, message.proposal)}
                          >
                            {slot.label}
                          </button>
                        ))}
                      </div>
                      {message.actionFeedback && (
                        <div className="mb-2 text-right text-[14px] font-bold text-[#0e1116]">{message.actionFeedback}</div>
                      )}
                      {message.selectedBookProposal && (
                        <div className="mt-3 rounded-xl border border-[#e6eaf2] bg-[#f8faff] p-3 text-right">
                          <div className="mb-2 text-[14px] font-extrabold text-[#0e1116]">
                            לקוח: {formatIssueInvoiceText(message.selectedBookProposal.clientName)}
                          </div>
                          <div className="mb-3 text-[13px] font-bold text-[#6b7686]">
                            מתי: {formatAppointmentWhenLabel(message.selectedBookProposal)}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              className="inline-flex min-h-10 items-center justify-center rounded-xl bg-[#1d5bff] px-4 py-2 text-sm font-extrabold text-white shadow-[0_10px_22px_rgba(29,91,255,0.22)] transition hover:bg-[#1746c7]"
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
                        <div className="text-[14px] font-extrabold text-[#0e1116]">לקוח: {formatIssueInvoiceText(message.proposal.clientName)}</div>
                        <div className="text-[13px] font-bold text-[#6b7686]">
                          מתי: {formatAppointmentWhenLabel(message.proposal)}
                        </div>
                        {message.proposal.serviceName?.trim() && (
                          <div className="text-[13px] font-bold text-[#6b7686]">
                            שירות: {formatIssueInvoiceText(message.proposal.serviceName)}
                          </div>
                        )}
                        {typeof message.proposal.durationMinutes === "number" && Number.isFinite(message.proposal.durationMinutes) && (
                          <div className="text-[13px] font-bold text-[#6b7686]">
                            משך: {message.proposal.durationMinutes} דקות
                          </div>
                        )}
                      </div>
                      {message.actionFeedback && (
                        <div className="mb-2 text-right text-[14px] font-bold text-[#0e1116]">{message.actionFeedback}</div>
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
                            className="inline-flex min-h-10 items-center justify-center rounded-xl bg-[#1d5bff] px-4 py-2 text-sm font-extrabold text-white shadow-[0_10px_22px_rgba(29,91,255,0.22)] transition hover:bg-[#1746c7] disabled:cursor-not-allowed disabled:bg-[#9badf7] disabled:shadow-none"
                          >
                            {message.actionStatus === "creating" ? "קובע תור..." : "אשר וקבע תור"}
                          </button>
                          <button
                            type="button"
                            disabled={message.actionStatus === "creating"}
                            onClick={() => cancelAppointmentProposal(message.id)}
                            className="inline-flex min-h-10 items-center justify-center rounded-xl border border-[#d7def0] bg-white px-4 py-2 text-sm font-extrabold text-[#6b7686] transition hover:border-[#1d5bff] hover:bg-[#e8eeff] hover:text-[#1d5bff] disabled:cursor-not-allowed disabled:opacity-60"
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
                        <div className="text-[14px] font-extrabold text-[#0e1116]">
                          ביטול תור — {formatIssueInvoiceText(message.proposal.clientName)}
                        </div>
                        {message.proposal.when?.trim() && (
                          <div className="text-[13px] font-bold text-[#6b7686]">
                            מתי: {formatIssueInvoiceText(message.proposal.when)}
                          </div>
                        )}
                        {message.proposal.serviceName?.trim() && (
                          <div className="text-[13px] font-bold text-[#6b7686]">
                            שירות: {formatIssueInvoiceText(message.proposal.serviceName)}
                          </div>
                        )}
                      </div>
                      {message.actionFeedback && (
                        <div className="mb-2 text-right text-[14px] font-bold text-[#0e1116]">{message.actionFeedback}</div>
                      )}
                      {(message.actionStatus === "pending" || message.actionStatus === "creating" || message.actionStatus === "error") && (
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={message.actionStatus === "creating"}
                            onClick={() => approveCancelExistingAppointmentProposal(message.id, message.proposal)}
                            className="inline-flex min-h-10 items-center justify-center rounded-xl bg-[#dc2626] px-4 py-2 text-sm font-extrabold text-white shadow-[0_10px_22px_rgba(220,38,38,0.22)] transition hover:bg-[#b91c1c] disabled:cursor-not-allowed disabled:bg-[#f87171] disabled:shadow-none"
                          >
                            {message.actionStatus === "creating" ? "מבטלת..." : "אשר ביטול"}
                          </button>
                          <button
                            type="button"
                            disabled={message.actionStatus === "creating"}
                            onClick={() => dismissCancelExistingAppointmentProposal(message.id)}
                            className="inline-flex min-h-10 items-center justify-center rounded-xl border border-[#d7def0] bg-white px-4 py-2 text-sm font-extrabold text-[#6b7686] transition hover:border-[#1d5bff] hover:bg-[#e8eeff] hover:text-[#1d5bff] disabled:cursor-not-allowed disabled:opacity-60"
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
                        <div className="text-[14px] font-extrabold text-[#0e1116]">
                          שינוי מועד — {formatIssueInvoiceText(message.proposal.clientName)}
                        </div>
                        <div className="text-[13px] font-bold text-[#6b7686]">
                          ל{formatIssueInvoiceText(message.proposal.newWhen)}
                        </div>
                      </div>
                      {message.actionFeedback && (
                        <div className="mb-2 text-right text-[14px] font-bold text-[#0e1116]">{message.actionFeedback}</div>
                      )}
                      {(message.actionStatus === "pending" || message.actionStatus === "creating" || message.actionStatus === "error") && (
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={message.actionStatus === "creating"}
                            onClick={() => approveRescheduleAppointmentProposal(message.id, message.proposal)}
                            className="inline-flex min-h-10 items-center justify-center rounded-xl bg-[#1d5bff] px-4 py-2 text-sm font-extrabold text-white shadow-[0_10px_22px_rgba(29,91,255,0.22)] transition hover:bg-[#1746c7] disabled:cursor-not-allowed disabled:bg-[#9badf7] disabled:shadow-none"
                          >
                            {message.actionStatus === "creating" ? "מעבירה..." : "אשר שינוי"}
                          </button>
                          <button
                            type="button"
                            disabled={message.actionStatus === "creating"}
                            onClick={() => dismissRescheduleAppointmentProposal(message.id)}
                            className="inline-flex min-h-10 items-center justify-center rounded-xl border border-[#d7def0] bg-white px-4 py-2 text-sm font-extrabold text-[#6b7686] transition hover:border-[#1d5bff] hover:bg-[#e8eeff] hover:text-[#1d5bff] disabled:cursor-not-allowed disabled:opacity-60"
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
                            <div className="text-[14px] font-extrabold text-[#0e1116]">
                              {invoice.supplierName ?? "ספק לא ידוע"}
                              {invoice.invoiceNumber ? ` · ${invoice.invoiceNumber}` : ""}
                            </div>
                            <div className="mt-1 text-[13px] font-bold text-[#6b7686]">
                              {invoice.amount.toLocaleString("he-IL")} {invoice.currency} · {formatInvoiceDate(invoice.issueDate)}
                            </div>
                            {invoice.driveUrl && (
                              <a
                                href={invoice.driveUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="mt-3 inline-flex min-h-10 items-center justify-center rounded-xl bg-[#1d5bff] px-4 py-2 text-sm font-extrabold text-white shadow-[0_10px_22px_rgba(29,91,255,0.22)] transition hover:bg-[#1746c7]"
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
                className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-[#d7def0] bg-white px-3 py-2 text-[13px] font-extrabold text-[#1d5bff] transition hover:border-[#1d5bff] hover:bg-[#e8eeff]"
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
                className="min-h-11 flex-1 rounded-[14px] border border-[#e6eaf2] bg-[#f4f6fb] px-3 py-2 text-[15px] font-semibold text-[#0e1116] outline-none placeholder:text-[#6b7686] focus:border-[#1d5bff] focus:bg-white focus:shadow-[0_0_0_4px_rgba(29,91,255,0.10)]"
                aria-label="הודעה לנטלי"
              />
              <button
                type="submit"
                disabled={!input.trim() || sending}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-[#1d5bff] text-white shadow-[0_10px_22px_rgba(29,91,255,0.22)] transition hover:bg-[#1746c7] disabled:cursor-not-allowed disabled:bg-[#9badf7] disabled:shadow-none"
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

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="group fixed bottom-5 right-4 z-[120] grid h-[3.75rem] w-[3.75rem] place-items-center rounded-full text-2xl font-black text-white transition hover:scale-[1.03] focus:outline-none focus:ring-4 lg:bottom-6 lg:right-[17rem]"
        style={{
          background: "linear-gradient(135deg, #3a6cff, #1d5bff, #1746c7)",
          boxShadow: "0 18px 40px rgba(29,91,255,0.32), 0 0 0 6px rgba(29,91,255,0.08)",
        }}
        aria-label={open ? "סגור את נטלי" : "פתח את נטלי"}
        aria-expanded={open}
      >
        <span className="absolute inset-0 rounded-full opacity-0 transition group-hover:opacity-100" style={{ boxShadow: "0 0 0 8px rgba(29,91,255,0.12)" }} />
        <span className="relative">נ</span>
      </button>

      {micState !== "idle" && (
        <div className="fixed inset-0 z-[180] grid place-items-center bg-[rgba(15,24,48,0.32)] p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="מצב הקלטה">
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
              onClick={stopAudioRecording}
              disabled={micState === "transcribing"}
              className="mt-6 inline-flex min-h-11 items-center justify-center rounded-xl bg-[#1d5bff] px-6 py-2.5 text-base font-extrabold text-white shadow-[0_12px_28px_rgba(29,91,255,0.24)] transition hover:bg-[#1746c7] disabled:cursor-not-allowed disabled:bg-[#9badf7] disabled:shadow-none"
            >
              {micState === "transcribing" ? "מתמלל…" : "עצור"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
