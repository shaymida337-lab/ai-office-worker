"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Mic, SendHorizontal, Volume2, VolumeX, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { apiFetch } from "@/lib/api";

type SpeechRecognitionConstructor = new () => SpeechRecognition;
type SpeechRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechRecognitionEvent = {
  results: ArrayLike<{
    0: { transcript: string };
    isFinal: boolean;
  }>;
};

type WidgetMessage = {
  id: string;
  sender: "natalie" | "user";
  text: string;
  action?: "create_task" | "complete_task";
  proposal?: TaskActionProposal;
  actionStatus?: "pending" | "creating" | "created" | "cancelled" | "error";
  actionFeedback?: string;
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

const GOOGLE_TTS_MAX_CHARS = 200;

function splitForGoogleTts(text: string) {
  const chunks: string[] = [];
  const words = text.split(/\s+/).filter(Boolean);
  let current = "";

  for (const word of words) {
    if (word.length > GOOGLE_TTS_MAX_CHARS) {
      if (current) chunks.push(current);
      current = "";
      for (let index = 0; index < word.length; index += GOOGLE_TTS_MAX_CHARS) {
        chunks.push(word.slice(index, index + GOOGLE_TTS_MAX_CHARS));
      }
      continue;
    }

    const next = current ? `${current} ${word}` : word;
    if (next.length <= GOOGLE_TTS_MAX_CHARS) {
      current = next;
    } else {
      chunks.push(current);
      current = word;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

export function NatalieAssistantWidget() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [speechError, setSpeechError] = useState("");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<WidgetMessage[]>(initialMessages);
  const [sending, setSending] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const speechSequenceRef = useRef(0);

  useEffect(() => {
    messagesRef.current?.scrollTo({
      top: messagesRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!shouldShowWidget(pathname)) return null;

  const SpeechRecognitionApi =
    typeof window !== "undefined"
      ? ((window as Window & { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor }).SpeechRecognition ??
          (window as Window & { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor }).webkitSpeechRecognition)
      : undefined;

  function speakNatalieReply(text: string) {
    const cleanText = text.trim();
    if (!voiceEnabled || !cleanText || cleanText === "נטלי חושבת...") return;
    if (typeof window === "undefined") return;

    stopCurrentSpeech();
    const chunks = splitForGoogleTts(cleanText);
    const sequence = speechSequenceRef.current;
    let chunkIndex = 0;

    const playNextChunk = () => {
      if (sequence !== speechSequenceRef.current || !voiceEnabled) return;
      const chunk = chunks[chunkIndex];
      if (!chunk) return;

      const audio = new Audio(`https://translate.google.com/translate_tts?ie=UTF-8&tl=iw&client=tw-ob&q=${encodeURIComponent(chunk)}`);
      audioRef.current = audio;
      audio.onended = () => {
        chunkIndex += 1;
        playNextChunk();
      };
      audio.onerror = () => speakWithBrowserFallback(chunks.slice(chunkIndex).join(" "));
      void audio.play().catch(() => speakWithBrowserFallback(chunks.slice(chunkIndex).join(" ")));
    };

    playNextChunk();
  }

  function stopCurrentSpeech() {
    speechSequenceRef.current += 1;
    audioRef.current?.pause();
    if (audioRef.current) audioRef.current.currentTime = 0;
    audioRef.current = null;
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  }

  function speakWithBrowserFallback(text: string) {
    const fallbackText = text.trim();
    if (!fallbackText || typeof window === "undefined" || !("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(fallbackText);
    utterance.lang = "he-IL";
    window.speechSynthesis.speak(utterance);
  }

  async function sendMessage(text = input) {
    const cleanText = text.trim();
    if (!cleanText || sending) return;

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

    try {
      const result = await apiFetch<NatalieAskResponse>("/api/natalie/ask", {
        method: "POST",
        body: JSON.stringify({ question: cleanText, history }),
      });
      const answer = result.answer?.trim() || "לא מצאתי תשובה לפי הנתונים הקיימים כרגע.";
      speakNatalieReply(answer);
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
              }
            : message
        )
      );
    } catch (err) {
      console.error("[natalie] ask failed", err);
      setMessages((current) =>
        current.map((message) =>
          message.id === loadingMessage.id
            ? { ...message, text: "מצטערת, לא הצלחתי להתחבר כרגע. נסה שוב." }
            : message
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

  function startSpeechRecognition() {
    if (!SpeechRecognitionApi || sending) {
      setSpeechError("הדפדפן לא תומך בזיהוי דיבור כרגע.");
      return;
    }

    setSpeechError("");
    const recognition = new SpeechRecognitionApi();
    recognitionRef.current = recognition;
    recognition.lang = "he-IL";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript ?? "")
        .join(" ")
        .trim();
      setInput(transcript);
    };
    recognition.onerror = () => {
      setSpeechError("לא הצלחתי לשמוע כרגע. נסה שוב.");
      setListening(false);
    };
    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };

    setListening(true);
    recognition.start();
  }

  function stopSpeechRecognition() {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setListening(false);
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
                </div>
              </div>
            ))}
          </div>

          <form onSubmit={onSubmit} className="shrink-0 border-t border-[#e6eaf2] bg-white p-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={startSpeechRecognition}
                disabled={!SpeechRecognitionApi || sending}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] border border-[#d7def0] bg-white text-[#1d5bff] transition hover:border-[#1d5bff] hover:bg-[#e8eeff]"
                aria-label="הפעל מצב הקשבה"
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
          </form>
        </section>
      )}

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="fixed bottom-5 right-4 z-[120] grid h-14 w-14 place-items-center rounded-full bg-[linear-gradient(135deg,#3a6cff,#1d5bff,#1746c7)] text-2xl font-black text-white shadow-[0_18px_40px_rgba(29,91,255,0.30)] transition hover:scale-105 focus:outline-none focus:ring-4 focus:ring-[#1d5bff]/20 lg:right-[17rem]"
        aria-label={open ? "סגור את נטלי" : "פתח את נטלי"}
        aria-expanded={open}
      >
        נ
      </button>

      {listening && (
        <div className="fixed inset-0 z-[180] grid place-items-center bg-[rgba(15,24,48,0.32)] p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="מצב הקשבה">
          <div className="natalie-message-enter w-full max-w-sm rounded-[28px] border border-[#e6eaf2] bg-white p-8 text-center shadow-[0_30px_90px_rgba(20,40,90,0.22)]" dir="rtl">
            <div className="relative mx-auto mb-6 grid h-36 w-36 place-items-center">
              <span className="absolute h-24 w-24 animate-ping rounded-full bg-[#1d5bff]/15" />
              <span className="absolute h-32 w-32 animate-pulse rounded-full border border-[#1d5bff]/20" />
              <span className="absolute h-36 w-36 animate-pulse rounded-full border border-[#1d5bff]/10" />
              <span className="relative grid h-24 w-24 place-items-center rounded-full bg-[linear-gradient(135deg,#3a6cff,#1d5bff,#1746c7)] text-white shadow-[0_18px_45px_rgba(29,91,255,0.30)]">
                <Mic className="h-10 w-10" />
              </span>
            </div>
            <h2 className="m-0 text-3xl font-extrabold text-[#0e1116]">מקשיבה…</h2>
            <p className="mx-auto mt-2 max-w-xs text-base font-semibold leading-7 text-[#6b7686]">
              דבר בעברית, ואני אמלא את ההודעה בשדה הצ׳אט.
            </p>
            {speechError && <p className="mx-auto mt-2 max-w-xs text-sm font-bold text-red-600">{speechError}</p>}
            <button
              type="button"
              onClick={stopSpeechRecognition}
              className="mt-6 inline-flex min-h-11 items-center justify-center rounded-xl bg-[#1d5bff] px-6 py-2.5 text-base font-extrabold text-white shadow-[0_12px_28px_rgba(29,91,255,0.24)] transition hover:bg-[#1746c7]"
            >
              עצור
            </button>
          </div>
        </div>
      )}
    </>
  );
}
