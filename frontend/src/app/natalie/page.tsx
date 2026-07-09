"use client";

import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  Check,
  ClipboardCheck,
  FileText,
  FolderOpen,
  ListChecks,
  MailCheck,
  SendHorizontal,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { GlobalHeader } from "@/components/natalie-ui";

type ChatMessage = {
  id: string;
  sender: "natalie" | "user";
  text: string;
  time: string;
  actionIds?: string[];
};

type ActionStatus = "pending" | "approved" | "cancelled";

type NatalieAction = {
  id: string;
  icon: "invoice" | "task";
  kicker: string;
  title: string;
  note: string;
  approvedText: string;
  cancelledText: string;
  metadata: Array<{ label: string; value: string }>;
};

const mockActions: Record<string, NatalieAction> = {
  invoice: {
    id: "invoice",
    icon: "invoice",
    kicker: "פעולה רגישה לאישור",
    title: "לשמור חשבונית בדרייב ולעדכן את הגיליון?",
    note: "נטלי זיהתה חשבונית חדשה ותבצע את הפעולה רק אחרי אישור שלך.",
    approvedText: "נשמר בדרייב · הגיליון עודכן",
    cancelledText: "בוטל — לא בוצעה פעולה",
    metadata: [
      { label: "סכום", value: "₪1,240" },
      { label: "ספק", value: "וולט לעסקים" },
      { label: "תיקייה", value: "Drive / חשבוניות / יוני" },
      { label: "סטטוס", value: "ממתין לאישור" },
    ],
  },
  task: {
    id: "task",
    icon: "task",
    kicker: "משימה מוצעת",
    title: "ליצור משימת מעקב ליום שלישי?",
    note: "נמצאה בקשת לקוח במייל. נטלי יכולה לפתוח משימה מסודרת עם תזכורת.",
    approvedText: "משימה נוצרה · תזכורת נקבעה",
    cancelledText: "בוטל — לא נוצרה משימה",
    metadata: [
      { label: "לקוח", value: "דנה כהן" },
      { label: "פעולה", value: "לחזור ללקוחה לגבי הצעת מחיר" },
      { label: "מועד", value: "יום שלישי, 10:00" },
      { label: "מקור", value: "Gmail" },
    ],
  },
};

const seedMessages: ChatMessage[] = [
  {
    id: "m1",
    sender: "natalie",
    text: "בוקר טוב, אני כאן. סרקתי את Gmail, Drive ו־WhatsApp ומצאתי כמה דברים שדורשים תשומת לב.",
    time: "09:12",
  },
  {
    id: "m2",
    sender: "natalie",
    text: "סיכום קצר: נכנסו 3 מיילים חדשים, חשבונית אחת מוולט לעסקים, ובקשת לקוח שכנראה צריכה להפוך למשימה.",
    time: "09:13",
    actionIds: ["invoice", "task"],
  },
  {
    id: "m3",
    sender: "user",
    text: "תראי לי רק דברים שצריכים אישור.",
    time: "09:14",
  },
  {
    id: "m4",
    sender: "natalie",
    text: "בטח. כרגע יש שתי פעולות שמחכות לאישור שלך. שום דבר לא יישמר, יישלח או יתעדכן בלי לחיצה מפורשת על אישור.",
    time: "09:14",
  },
];

const cannedReplies: Array<{ triggers: string[]; reply: string }> = [
  {
    triggers: ["דחוף", "היום"],
    reply: "היום יש 2 דברים דחופים: חשבונית אחת לאישור ומשימת לקוח שצריכה טיפול עד 10:00. רוצה שאכין לך סדר פעולות קצר?",
  },
  {
    triggers: ["חשבוניות", "חודש"],
    reply: "החודש נכנסו 18 חשבוניות. 16 כבר מסודרות בדרייב ו־2 מחכות לאישור שלך לפני עדכון Google Sheets.",
  },
  {
    triggers: ["רואה", "דוח"],
    reply: "אפשר להכין דוח חודשי לרואה החשבון. לפני יצירה או שליחה אציג לך תצוגה מקדימה ואבקש אישור.",
  },
  {
    triggers: ["משימות", "פתוחות"],
    reply: "מצאתי 4 משימות פתוחות: שתי שיחות לקוחות, בדיקת חשבונית אחת, ותזכורת תשלום לספק.",
  },
];

const quickSuggestions = [
  "מה דחוף היום?",
  "כמה חשבוניות נכנסו החודש?",
  "תכיני דוח לרואה חשבון",
  "איזה משימות פתוחות?",
];

function getCurrentTime() {
  return new Intl.DateTimeFormat("he-IL", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

function getMockReply(message: string) {
  const normalized = message.trim().toLowerCase();
  const match = cannedReplies.find((item) =>
    item.triggers.some((trigger) => normalized.includes(trigger))
  );

  return (
    match?.reply ??
    "קיבלתי. בדמו הזה אני עונה עם נתוני mock בלבד, אבל ההתנהגות מדמה את נטלי: קודם מסכמת, אחר כך מציעה פעולה, ותמיד מבקשת אישור לפני משהו רגיש."
  );
}

export default function NatalieChatPage() {
  const [messages, setMessages] = useState(seedMessages);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [actionStatus, setActionStatus] = useState<Record<string, ActionStatus>>({
    invoice: "pending",
    task: "pending",
  });
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, typing, actionStatus]);

  const pendingActions = useMemo(
    () => Object.values(actionStatus).filter((status) => status === "pending").length,
    [actionStatus]
  );

  function resolveAction(actionId: string, status: Exclude<ActionStatus, "pending">) {
    setActionStatus((current) => ({ ...current, [actionId]: status }));
  }

  function sendMessage(text = input) {
    const cleanText = text.trim();
    if (!cleanText || typing) return;

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      sender: "user",
      text: cleanText,
      time: getCurrentTime(),
    };

    setMessages((current) => [...current, userMessage]);
    setInput("");
    setTyping(true);

    window.setTimeout(() => {
      const natalieMessage: ChatMessage = {
        id: `natalie-${Date.now()}`,
        sender: "natalie",
        text: getMockReply(cleanText),
        time: getCurrentTime(),
      };

      setMessages((current) => [...current, natalieMessage]);
      setTyping(false);
      inputRef.current?.focus();
    }, 900);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    sendMessage();
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  }

  return (
    <main className="natalie-chat-page fixed inset-0 z-50 h-[100dvh] overflow-hidden bg-[#f4f6fb] text-[#0f1830]" dir="rtl">
      <GlobalHeader />
      <section className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col px-4 pb-4 pt-[calc(3.5rem+env(safe-area-inset-top,0px))] sm:px-6 lg:px-8">
        <div className="z-20 mb-4 shrink-0 rounded-[22px] border border-[#e6eaf2] bg-white/90 p-4 shadow-[0_10px_34px_rgba(20,40,90,0.10)] backdrop-blur md:p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="m-0 text-[24px] font-extrabold tracking-tight text-[#0f1830] md:text-[28px]">צ׳אט עם נטלי</h1>
                <span className="rounded-full bg-[#eaf0ff] px-3 py-1 text-xs font-bold text-[#1d5bff]">AI Office Worker</span>
              </div>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-base font-semibold text-[#6b7686] md:text-[17px]">
                <span className="h-2.5 w-2.5 rounded-full bg-[#1faa59] shadow-[0_0_0_5px_rgba(31,170,89,0.12)]" />
                פעילה · מחוברת ל‑Gmail, Drive, WhatsApp
              </p>
            </div>
            <div className="hidden items-center gap-2 rounded-full border border-[#e6eaf2] bg-[#f4f6fb] px-4 py-2 text-sm font-bold text-[#0f1830] sm:flex">
              <ShieldCheck className="h-4 w-4 text-[#1faa59]" />
              {pendingActions} פעולות ממתינות לאישור
            </div>
          </div>
        </div>

        <div className="mx-auto grid min-h-0 w-full max-w-[960px] flex-1 gap-4 lg:grid-cols-[minmax(0,760px)_170px]">
          <section className="flex min-h-0 rounded-[26px] border border-[#e6eaf2] bg-white/70 shadow-[0_18px_55px_rgba(20,40,90,0.08)]">
            <div
              ref={scrollRef}
              className="h-full min-h-0 flex-1 overflow-y-auto px-3 py-5 sm:px-5 md:px-6"
              aria-live="polite"
            >
              <div className="space-y-5">
                {messages.map((message) => (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    actionStatus={actionStatus}
                    onResolveAction={resolveAction}
                  />
                ))}
                {typing && <TypingIndicator />}
              </div>
            </div>
          </section>

          <aside className="hidden min-h-0 rounded-[24px] border border-[#e6eaf2] bg-white p-4 shadow-[0_12px_40px_rgba(20,40,90,0.08)] lg:block">
            <div className="mb-3 flex items-center gap-2 text-[15px] font-extrabold text-[#0f1830]">
              <Sparkles className="h-4 w-4 text-[#1d5bff]" />
              מה נטלי רואה
            </div>
            <div className="space-y-3 text-[15px]">
              <Insight icon={<MailCheck className="h-4 w-4" />} label="3 מיילים חדשים" />
              <Insight icon={<FileText className="h-4 w-4" />} label="חשבונית אחת לאישור" />
              <Insight icon={<ListChecks className="h-4 w-4" />} label="משימה אחת מוצעת" />
              <Insight icon={<FolderOpen className="h-4 w-4" />} label="Drive מסונכרן" />
            </div>
          </aside>
        </div>

        <footer className="mx-auto mt-4 w-full max-w-[760px] shrink-0">
          <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
            {quickSuggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => sendMessage(suggestion)}
                disabled={typing}
                className="shrink-0 rounded-full border border-[#d7def0] bg-white px-4 py-2.5 text-[15px] font-bold text-[#1d5bff] shadow-[0_8px_22px_rgba(20,40,90,0.06)] transition hover:-translate-y-0.5 hover:border-[#1d5bff] hover:bg-[#eaf0ff] focus:outline-none focus:ring-4 focus:ring-[#1d5bff]/15 disabled:cursor-not-allowed disabled:opacity-60 md:text-base"
              >
                {suggestion}
              </button>
            ))}
          </div>

          <form
            onSubmit={onSubmit}
            className="rounded-[24px] border border-[#e6eaf2] bg-white p-2 shadow-[0_18px_50px_rgba(20,40,90,0.11)]"
          >
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={onComposerKeyDown}
                placeholder="כתבו לנטלי מה לבדוק או להכין..."
                aria-label="הודעה לנטלי"
                className="min-h-14 flex-1 rounded-[18px] border-0 bg-[#f4f6fb] px-4 py-3 text-[17px] font-medium text-[#0f1830] outline-none ring-1 ring-transparent placeholder:text-[#6b7686] focus:bg-white focus:ring-[#1d5bff]/30"
              />
              <button
                type="submit"
                disabled={!input.trim() || typing}
                className="grid h-14 w-14 shrink-0 place-items-center rounded-[18px] bg-[#1d5bff] text-white shadow-[0_12px_26px_rgba(29,91,255,0.28)] transition hover:bg-[#1648cc] focus:outline-none focus:ring-4 focus:ring-[#1d5bff]/20 disabled:cursor-not-allowed disabled:bg-[#9badf7] disabled:shadow-none"
                aria-label="שליחת הודעה"
              >
                <SendHorizontal className="h-5 w-5 rotate-180" />
              </button>
            </div>
          </form>
          <p className="mt-2 text-center text-sm font-semibold text-[#6b7686]">
            נטלי מבקשת אישור לפני כל פעולה רגישה · אתה תמיד בשליטה
          </p>
        </footer>
      </section>
    </main>
  );
}

function MessageBubble({
  message,
  actionStatus,
  onResolveAction,
}: {
  message: ChatMessage;
  actionStatus: Record<string, ActionStatus>;
  onResolveAction: (actionId: string, status: Exclude<ActionStatus, "pending">) => void;
}) {
  const isUser = message.sender === "user";

  return (
    <article
      className={`natalie-message-enter flex w-full ${isUser ? "justify-end" : "justify-start"}`}
      dir="ltr"
    >
      <div className="max-w-[92%] sm:max-w-[78%]" dir="rtl">
        <div className={`flex items-end gap-2 ${isUser ? "flex-row-reverse" : ""}`}>
          {!isUser && (
            <div className="mb-5 grid h-9 w-9 shrink-0 place-items-center rounded-[14px] bg-[#eaf0ff] text-[#1d5bff]">
              <Bot className="h-5 w-5" />
            </div>
          )}
          <div>
            <div
              className={
                isUser
                  ? "rounded-[18px] rounded-bl-[5px] bg-[#1d5bff] px-5 py-3.5 text-right text-[17px] font-medium leading-[1.6] text-white shadow-[0_14px_32px_rgba(29,91,255,0.22)]"
                  : "rounded-[18px] rounded-br-[5px] border border-[#e6eaf2] bg-white px-5 py-3.5 text-right text-[17px] font-medium leading-[1.6] text-[#0f1830] shadow-[0_10px_28px_rgba(20,40,90,0.07)]"
              }
            >
              {message.text}
            </div>
            <time className={`mt-1 block text-xs font-semibold text-[#8a94a6] ${isUser ? "text-left" : "text-right"}`}>
              {message.time}
            </time>
            {message.actionIds?.map((actionId) => (
              <ActionCard
                key={actionId}
                action={mockActions[actionId]}
                status={actionStatus[actionId] ?? "pending"}
                onApprove={() => onResolveAction(actionId, "approved")}
                onCancel={() => onResolveAction(actionId, "cancelled")}
              />
            ))}
          </div>
        </div>
      </div>
    </article>
  );
}

function ActionCard({
  action,
  status,
  onApprove,
  onCancel,
}: {
  action: NatalieAction;
  status: ActionStatus;
  onApprove: () => void;
  onCancel: () => void;
}) {
  const resolved = status !== "pending";
  const Icon = action.icon === "invoice" ? FileText : ClipboardCheck;

  return (
    <section className="natalie-message-enter mt-3 rounded-[18px] border border-[#dfe6f5] bg-white p-4 shadow-[0_14px_36px_rgba(20,40,90,0.09)]">
      <div className="flex items-start gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-[15px] bg-[#eaf0ff] text-[#1d5bff]">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
            <div className="text-[13px] font-extrabold uppercase tracking-[0.18em] text-[#1d5bff]">
            {action.kicker}
          </div>
          <h2 className="mt-1 text-xl font-extrabold leading-snug text-[#0f1830]">
            {action.title}
          </h2>
          <dl className="mt-3 grid gap-2">
            {action.metadata.map((item) => (
              <div
                key={`${action.id}-${item.label}`}
                className="flex items-center justify-between gap-3 rounded-[12px] bg-[#f4f6fb] px-3 py-2 text-[15px]"
              >
                <dt className="font-bold text-[#6b7686]">{item.label}</dt>
                <dd className="text-left font-extrabold text-[#0f1830]">{item.value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-[15px] font-medium leading-7 text-[#6b7686]">{action.note}</p>

          {resolved ? (
            <div
              className={`mt-4 flex items-center gap-2 rounded-[14px] px-3 py-2 text-sm font-extrabold ${
                status === "approved"
                  ? "bg-[#e8f8ef] text-[#1faa59]"
                  : "bg-[#f4f6fb] text-[#6b7686]"
              }`}
            >
              {status === "approved" ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
              {status === "approved" ? action.approvedText : action.cancelledText}
            </div>
          ) : (
            <div className="mt-4 grid gap-2 sm:flex">
              <button
                type="button"
                onClick={onApprove}
                className="inline-flex items-center justify-center gap-2 rounded-[12px] bg-[#1d5bff] px-4 py-2.5 text-sm font-extrabold text-white shadow-[0_12px_24px_rgba(29,91,255,0.22)] transition hover:bg-[#1648cc] focus:outline-none focus:ring-4 focus:ring-[#1d5bff]/20"
              >
                <Check className="h-4 w-4" />
                אישור
              </button>
              <button
                type="button"
                onClick={onCancel}
                className="inline-flex items-center justify-center gap-2 rounded-[12px] border border-[#d7def0] bg-white px-4 py-2.5 text-sm font-extrabold text-[#6b7686] transition hover:bg-[#f4f6fb] focus:outline-none focus:ring-4 focus:ring-[#1d5bff]/15"
              >
                <X className="h-4 w-4" />
                ביטול
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function TypingIndicator() {
  return (
    <div className="natalie-message-enter flex justify-start" dir="ltr">
      <div className="flex items-center gap-2 rounded-[18px] rounded-br-[5px] border border-[#e6eaf2] bg-white px-4 py-3 shadow-[0_10px_28px_rgba(20,40,90,0.07)]" dir="rtl">
        <span className="text-sm font-bold text-[#6b7686]">נטלי מקלידה</span>
        <span className="natalie-typing-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </div>
    </div>
  );
}

function Insight({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-[16px] border border-[#e6eaf2] bg-[#f4f6fb] px-3 py-2 font-bold text-[#6b7686]">
      <span className="text-[#1d5bff]">{icon}</span>
      {label}
    </div>
  );
}
