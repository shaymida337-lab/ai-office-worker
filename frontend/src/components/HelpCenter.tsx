"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch, getToken } from "@/lib/api";
import { commonIssues, getAllHelpTopics, helpCategories, type AutoFixAction, type HelpTopic } from "@/data/helpTopics";

type TopicWithCategory = ReturnType<typeof getAllHelpTopics>[number];
type ChatMessage = { role: "user" | "assistant"; text: string };
type ChecklistItem = { id: string; label: string; done: boolean; href: string };

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const SUPPORT_PHONE = (process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP ?? process.env.NEXT_PUBLIC_OWNER_WHATSAPP ?? "").replace(/[^\d]/g, "");

const defaultChecklist: ChecklistItem[] = [
  { id: "gmail", label: "חבר Gmail", done: false, href: "/dashboard" },
  { id: "client", label: "הוסף לקוח ראשון", done: false, href: "/dashboard/clients" },
  { id: "scan", label: "הרץ סריקה ראשונה", done: false, href: "/dashboard" },
  { id: "report", label: "צפה בדוח ראשון", done: false, href: "/dashboard/accountant" },
];

export function HelpCenter() {
  const allTopics = useMemo(() => getAllHelpTopics(), []);
  const commonTopics = useMemo(() => allTopics.filter((topic) => commonIssues.includes(topic.id)), [allTopics]);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [topic, setTopic] = useState<TopicWithCategory | null>(null);
  const [triedSolution, setTriedSolution] = useState(false);
  const [showWhatsApp, setShowWhatsApp] = useState(false);
  const [question, setQuestion] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [autoFixLoading, setAutoFixLoading] = useState(false);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [checklist, setChecklist] = useState(defaultChecklist);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    if (open && getToken()) void loadChecklist();
  }, [open]);

  const selectedCategory = helpCategories.find((category) => category.id === categoryId) ?? null;
  const searchResults = useMemo(() => {
    if (!debouncedSearch) return [];
    const query = debouncedSearch.toLowerCase();
    return allTopics.filter((item) =>
      [item.title, item.shortDesc, item.category.title, item.explanation, ...(item.steps ?? [])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [allTopics, debouncedSearch]);

  async function loadChecklist() {
    try {
      const [gmail, clients, scan] = await Promise.all([
        apiFetch<{ connected: boolean }>("/api/integrations/gmail/status"),
        apiFetch<{ clients: unknown[] }>("/api/clients"),
        apiFetch<{ last: { status: string } | null }>("/api/automation/scan-status"),
      ]);
      setChecklist([
        { id: "gmail", label: "חבר Gmail", done: gmail.connected, href: "/dashboard" },
        { id: "client", label: "הוסף לקוח ראשון", done: clients.clients.length > 0, href: "/dashboard/clients" },
        { id: "scan", label: "הרץ סריקה ראשונה", done: Boolean(scan.last), href: "/dashboard" },
        { id: "report", label: "צפה בדוח ראשון", done: scan.last?.status === "success", href: "/dashboard/accountant" },
      ]);
    } catch {
      setChecklist(defaultChecklist);
    }
  }

  function openTopic(nextTopic: TopicWithCategory) {
    setTopic(nextTopic);
    setCategoryId(nextTopic.category.id);
    setTriedSolution(false);
    setShowWhatsApp(false);
  }

  async function runAutoFix(action: AutoFixAction | null | undefined) {
    setTriedSolution(true);
    if (!action) return;
    if (action === "reload") window.location.reload();
    if (action === "clear-cache") {
      localStorage.clear();
      window.location.reload();
    }
    if (action === "reconnect-gmail") window.location.href = `${API_URL}/auth/google`;
    if (action === "rescan-gmail") {
      setAutoFixLoading(true);
      setChat((messages) => [...messages, { role: "assistant", text: "מתקן אוטומטית..." }]);
      try {
        const result = await apiFetch<{ invoicesFound: number; emailsScanned: number; clientsFound: number; labelCreated: boolean }>("/api/help/auto-fix/invoices", { method: "POST" });
        setChat((messages) => [
          ...messages,
          {
            role: "assistant",
            text: `✅ תוקן! נמצאו ${result.invoicesFound} חשבוניות. נסרקו ${result.emailsScanned} מיילים ונמצאו ${result.clientsFound} לקוחות${result.labelCreated ? " | נוצרה תווית Gmail לחשבוניות" : ""}.`,
          },
        ]);
      } catch (err) {
        setChat((messages) => [...messages, { role: "assistant", text: err instanceof Error ? err.message : "התיקון האוטומטי נכשל. נסה לחבר Gmail מחדש." }]);
      } finally {
        setAutoFixLoading(false);
      }
    }
  }

  async function askAi() {
    const clean = question.trim();
    if (!clean || aiLoading) return;
    setChat((messages) => [...messages, { role: "user", text: clean }]);
    setQuestion("");
    setAiLoading(true);
    try {
      const result = await apiFetch<{ answer: string }>("/api/help/ask", { method: "POST", body: JSON.stringify({ question: clean }) });
      setChat((messages) => [...messages, { role: "assistant", text: result.answer }]);
      if (result.answer.includes("לא מצאתי תשובה")) setShowWhatsApp(true);
    } catch {
      setChat((messages) => [...messages, { role: "assistant", text: "לא מצאתי תשובה, שלח לנו WhatsApp" }]);
      setShowWhatsApp(true);
    } finally {
      setAiLoading(false);
    }
  }

  const completion = Math.round((checklist.filter((item) => item.done).length / checklist.length) * 100);

  return (
    <>
      <button className={`help-fab ${open ? "help-fab-open" : ""}`} onClick={() => setOpen(true)} aria-label="פתח מרכז עזרה">
        <span className="help-fab-text">עזרה</span>
      </button>
      {open && (
        <div className="help-overlay" role="dialog" aria-modal="true">
          <div className="help-modal">
            <header className="help-header">
              <div>
                <h2>🤝 מרכז העזרה</h2>
                <p>פתרון עצמי מהיר לפני פנייה לתמיכה</p>
              </div>
              <button className="help-close" onClick={() => setOpen(false)} aria-label="סגור">×</button>
              <input className="help-search" placeholder="חפש בעיה או שאלה..." value={search} onChange={(event) => setSearch(event.target.value)} />
            </header>
            <main className="help-body">
              {topic ? (
                <TopicDetail
                  topic={topic}
                  autoFixLoading={autoFixLoading}
                  triedSolution={triedSolution}
                  showWhatsApp={showWhatsApp}
                  onBack={() => setTopic(null)}
                  onAutoFix={runAutoFix}
                  onTry={() => setTriedSolution(true)}
                  onAskAi={() => {
                    setQuestion(topic.title);
                    setTopic(null);
                  }}
                  onStillBroken={() => {
                    setTriedSolution(true);
                    setShowWhatsApp(true);
                  }}
                />
              ) : (
                <>
                  {debouncedSearch ? (
                    <SearchResults query={debouncedSearch} results={searchResults} onOpen={openTopic} />
                  ) : (
                    <>
                      <OnboardingChecklist completion={completion} items={checklist} />
                      <section className="help-section">
                        <h3>בעיות נפוצות 🔧</h3>
                        <div className="help-grid">
                          {commonTopics.map((item) => <TopicCard key={item.id} topic={item} onOpen={openTopic} />)}
                        </div>
                      </section>
                      <section className="help-section">
                        <h3>נושאים 📚</h3>
                        <div className="help-grid">
                          {helpCategories.map((category) => (
                            <button className="help-category-card" key={category.id} onClick={() => setCategoryId(category.id)}>
                              <span className={categoryTone(category.id, "text")}>{category.icon}</span>
                              <strong>{category.title}</strong>
                              <small>{category.description}</small>
                            </button>
                          ))}
                        </div>
                      </section>
                      {selectedCategory && (
                        <section className="help-section">
                          <h3>{selectedCategory.icon} {selectedCategory.title}</h3>
                          <div className="help-list">
                            {selectedCategory.topics.map((item) => (
                              <button className="help-result" key={item.id} onClick={() => openTopic({ ...item, category: selectedCategory })}>
                                <strong>{item.title}</strong>
                                <small>{item.shortDesc}</small>
                              </button>
                            ))}
                          </div>
                        </section>
                      )}
                    </>
                  )}
                  <AiChat question={question} loading={aiLoading} chat={chat} showWhatsApp={showWhatsApp} onQuestionChange={setQuestion} onAsk={askAi} onBadAnswer={() => setShowWhatsApp(true)} />
                </>
              )}
            </main>
          </div>
        </div>
      )}
    </>
  );
}

function TopicCard({ topic, onOpen }: { topic: TopicWithCategory; onOpen: (topic: TopicWithCategory) => void }) {
  return (
    <button className="help-topic-card" onClick={() => onOpen(topic)}>
      <span className={`help-category-badge ${categoryTone(topic.category.id, "bg")}`}>{topic.category.icon}</span>
      <strong>{topic.title}</strong>
      <small>{topic.shortDesc}</small>
      {topic.autoFix && <span className="help-one-click">תקן אוטומטית →</span>}
    </button>
  );
}

function SearchResults({ query, results, onOpen }: { query: string; results: TopicWithCategory[]; onOpen: (topic: TopicWithCategory) => void }) {
  return (
    <section className="help-section">
      <h3>תוצאות חיפוש</h3>
      {results.length ? (
        <div className="help-list">
          {results.map((topic) => (
            <button className="help-result" key={topic.id} onClick={() => onOpen(topic)}>
              <span className={`help-category-badge ${categoryTone(topic.category.id, "bg")}`}>{topic.category.icon} {topic.category.title}</span>
              <strong>{highlight(topic.title, query)}</strong>
              <small>{highlight(topic.shortDesc, query)}</small>
            </button>
          ))}
        </div>
      ) : (
        <div className="help-empty">לא מצאת? שאל את ה-AI →</div>
      )}
    </section>
  );
}

function TopicDetail(props: {
  topic: TopicWithCategory;
  autoFixLoading: boolean;
  triedSolution: boolean;
  showWhatsApp: boolean;
  onBack: () => void;
  onAutoFix: (action: AutoFixAction | null | undefined) => void;
  onTry: () => void;
  onAskAi: () => void;
  onStillBroken: () => void;
}) {
  return (
    <section className="help-detail">
      <button className="help-back" onClick={props.onBack}>← חזרה</button>
      <span className={`help-category-badge ${categoryTone(props.topic.category.id, "bg")}`}>{props.topic.category.icon} {props.topic.category.title}</span>
      <h3>🔧 {props.topic.title}</h3>
      <p>{props.topic.shortDesc}</p>
      {props.topic.explanation && <pre className="help-explanation">{props.topic.explanation}</pre>}
      {props.topic.steps && (
        <div className="help-steps">
          <h4>פתרון צעד אחר צעד:</h4>
          {props.topic.steps.map((step, index) => (
            <div className="help-step" key={step}>
              <strong>✅ צעד {index + 1}</strong>
              <span>{step}</span>
              {index === 0 && props.topic.autoFix && <button className="btn btn-secondary" onClick={() => props.onAutoFix(props.topic.autoFix)} disabled={props.autoFixLoading}>{props.autoFixLoading ? "מתקן אוטומטית..." : "תקן אוטומטית →"}</button>}
            </div>
          ))}
        </div>
      )}
      {props.topic.troubleshooting?.map((item) => (
        <div className="help-trouble" key={item.problem}>
          <strong>{item.problem}</strong>
          <p>{item.solution}</p>
          {item.autoFix && <button className="btn btn-secondary" onClick={() => props.onAutoFix(item.autoFix)} disabled={props.autoFixLoading}>{props.autoFixLoading ? "מתקן אוטומטית..." : "תקן אוטומטית →"}</button>}
        </div>
      ))}
      <div className="help-detail-actions">
        <button className="btn btn-secondary" onClick={props.onTry}>ניסיתי את הפתרון</button>
        <button className="btn btn-secondary" onClick={props.onAskAi}>שאל את ה-AI</button>
        <button className="btn" onClick={props.onStillBroken}>עדיין לא עובד</button>
      </div>
      {props.showWhatsApp && <EscalationBox topic={props.topic} triedSolution={props.triedSolution} />}
    </section>
  );
}

function AiChat(props: { question: string; loading: boolean; chat: ChatMessage[]; showWhatsApp: boolean; onQuestionChange: (value: string) => void; onAsk: () => void; onBadAnswer: () => void }) {
  return (
    <section className="help-section">
      <h3>שאל AI 🤖</h3>
      <div className="help-chat">
        {props.chat.map((message, index) => (
          <div className={`help-message help-message-${message.role}`} key={`${message.role}-${index}`}>
            {message.text}
            {message.role === "assistant" && <div className="help-feedback">האם זה עזר? <button>👍</button><button onClick={props.onBadAnswer}>👎</button></div>}
          </div>
        ))}
        {props.loading && <div className="help-message help-message-assistant">ה-AI חושב...</div>}
      </div>
      <div className="help-ai-row">
        <input placeholder="למשל: למה Gmail לא סורק?" value={props.question} onChange={(event) => props.onQuestionChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") props.onAsk(); }} />
        <button className="btn" onClick={props.onAsk} disabled={props.loading}>שלח</button>
      </div>
      {props.showWhatsApp && <GenericEscalationBox />}
    </section>
  );
}

function OnboardingChecklist({ completion, items }: { completion: number; items: ChecklistItem[] }) {
  return (
    <section className="help-section help-checklist">
      <div><h3>צ'קליסט התחלה מהירה</h3><p>{completion}% הושלם</p></div>
      <progress className="help-progress" value={completion} max={100} />
      {items.map((item) => <button key={item.id} onClick={() => { window.location.href = item.href; }}><span>{item.done ? "☑" : "☐"}</span>{item.label}</button>)}
    </section>
  );
}

function categoryTone(categoryId: string, type: "text" | "bg") {
  const tones: Record<string, { text: string; bg: string }> = {
    gmail: { text: "text-emerald-300", bg: "bg-emerald-500" },
    drive: { text: "text-blue-300", bg: "bg-blue-500" },
    whatsapp: { text: "text-violet-300", bg: "bg-violet-500" },
    invoices: { text: "text-amber-300", bg: "bg-amber-500" },
    sheets: { text: "text-cyan-300", bg: "bg-cyan-500" },
    general: { text: "text-slate-300", bg: "bg-slate-500" },
  };
  return tones[categoryId]?.[type] ?? tones.general[type];
}

function EscalationBox({ topic, triedSolution }: { topic: HelpTopic; triedSolution: boolean }) {
  const message = ["שלום! אני צריך עזרה עם AI Office Worker.", `הבעיה שלי: ${topic.title}`, `ניסיתי: ${triedSolution ? "עברתי על הפתרון במרכז העזרה" : "עדיין לא ניסיתי פתרון"}`, "עדיין לא עובד."].join("\n");
  const url = `https://wa.me/${SUPPORT_PHONE}?text=${encodeURIComponent(message)}`;
  return (
    <div className="help-escalation">
      <strong>עדיין לא עובד?</strong>
      <p>WhatsApp לבעלים מופיע רק אחרי שניסית פתרון, ונשלח עם הקשר מלא.</p>
      {SUPPORT_PHONE ? <a className="btn" href={url} target="_blank" rel="noreferrer">שלח WhatsApp</a> : <button className="btn" disabled>WhatsApp לא הוגדר</button>}
      <small>נושא: {topic.title}</small>
    </div>
  );
}

function GenericEscalationBox() {
  const message = ["שלום! אני צריך עזרה עם AI Office Worker.", "הבעיה שלי: שאלתי את מרכז העזרה ולא נמצאה תשובה.", "ניסיתי: שאלתי את ה-AI.", "עדיין לא עובד."].join("\n");
  const url = `https://wa.me/${SUPPORT_PHONE}?text=${encodeURIComponent(message)}`;
  return (
    <div className="help-escalation">
      <strong>לא מצאת תשובה?</strong>
      <p>אפשר לשלוח WhatsApp עם הקשר מלא רק אחרי ניסיון פתרון עצמי.</p>
      {SUPPORT_PHONE ? <a className="btn" href={url} target="_blank" rel="noreferrer">שלח WhatsApp</a> : <button className="btn" disabled>WhatsApp לא הוגדר</button>}
    </div>
  );
}

function highlight(text: string, query: string) {
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (!query || index === -1) return text;
  return <>{text.slice(0, index)}<mark>{text.slice(index, index + query.length)}</mark>{text.slice(index + query.length)}</>;
}
