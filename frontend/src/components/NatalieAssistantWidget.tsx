"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Mic, SendHorizontal, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { apiFetch } from "@/lib/api";

type WidgetMessage = {
  id: string;
  sender: "natalie" | "user";
  text: string;
};

type NatalieAskResponse = {
  answer: string;
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

export function NatalieAssistantWidget() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<WidgetMessage[]>(initialMessages);
  const [sending, setSending] = useState(false);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

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

  async function sendMessage(text = input) {
    const cleanText = text.trim();
    if (!cleanText || sending) return;

    const timestamp = Date.now();
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
        body: JSON.stringify({ question: cleanText }),
      });
      const answer = result.answer?.trim() || "לא מצאתי תשובה לפי הנתונים הקיימים כרגע.";
      setMessages((current) =>
        current.map((message) =>
          message.id === loadingMessage.id ? { ...message, text: answer } : message
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
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[#e6eaf2] bg-[#f4f6fb] text-[#6b7686] transition hover:bg-[#e8eeff] hover:text-[#1d5bff]"
              aria-label="סגור את נטלי"
            >
              <X className="h-5 w-5" />
            </button>
          </header>

          <div ref={messagesRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-[#f4f6fb] px-4 py-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`natalie-message-enter flex ${message.sender === "user" ? "justify-end" : "justify-start"}`}
                dir="ltr"
              >
                <div
                  className={
                    message.sender === "user"
                      ? "max-w-[86%] rounded-[18px] rounded-bl-[5px] bg-[#1d5bff] px-4 py-2.5 text-right text-[15px] font-semibold leading-6 text-white shadow-[0_12px_24px_rgba(29,91,255,0.18)]"
                      : "max-w-[86%] rounded-[18px] rounded-br-[5px] border border-[#e6eaf2] bg-white px-4 py-2.5 text-right text-[15px] font-semibold leading-6 text-[#0e1116] shadow-[0_8px_20px_rgba(20,40,90,0.06)]"
                  }
                  dir="rtl"
                >
                  {message.text}
                </div>
              </div>
            ))}
          </div>

          <form onSubmit={onSubmit} className="shrink-0 border-t border-[#e6eaf2] bg-white p-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setListening(true)}
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
              מצב קולי להדגמה בלבד. בהמשך נטלי תוכל להבין דיבור ולבקש אישור לפני פעולות רגישות.
            </p>
            <button
              type="button"
              onClick={() => setListening(false)}
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
