"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { MessageCircle } from "lucide-react";
import { LANDING_DEMO, LANDING_DEMO_PROMPTS } from "./landingContent";
import { colors, radius, shadow, type as typography } from "@/lib/design-tokens";

type DemoMessage = { from: "natalie" | "user"; text: string };

const TYPING_DELAY_MS = 900;

export function LandingDemoSection() {
  const [messages, setMessages] = useState<DemoMessage[]>([
    { from: "natalie", text: LANDING_DEMO.greeting },
  ]);
  const [typing, setTyping] = useState(false);
  const [usedPrompts, setUsedPrompts] = useState<string[]>([]);
  const timeoutRef = useRef<number | null>(null);
  const threadRef = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    };
  }, []);

  useEffect(() => {
    const thread = threadRef.current;
    if (thread) thread.scrollTop = thread.scrollHeight;
  }, [messages, typing]);

  function onPromptClick(prompt: string, response: string) {
    if (typing) return;
    setMessages((current) => [...current, { from: "user", text: prompt }]);
    setUsedPrompts((current) => (current.includes(prompt) ? current : [...current, prompt]));
    setTyping(true);
    timeoutRef.current = window.setTimeout(() => {
      setMessages((current) => [...current, { from: "natalie", text: response }]);
      setTyping(false);
    }, TYPING_DELAY_MS);
  }

  return (
    <section id="demo" className="overflow-x-hidden px-4 py-12 sm:px-6 sm:py-16" aria-label="דמו אינטראקטיבי של נטלי">
      <div className="mx-auto max-w-6xl">
        <div
          className={`${radius.card} border ${shadow.soft} grid gap-8 overflow-hidden p-5 sm:p-7 lg:grid-cols-2 lg:items-center lg:gap-10 lg:p-8`}
          style={{ backgroundColor: colors.accentMuted, borderColor: colors.borderSubtle }}
        >
          <div className="min-w-0 text-right">
            <p className="page-kicker">{LANDING_DEMO.kicker}</p>
            <h2 className={`${typography.h2} mb-3`} style={{ color: colors.textPrimary }}>
              {LANDING_DEMO.title}
            </h2>
            <p className="max-w-xl text-base font-medium leading-7" style={{ color: colors.textSecondary }}>
              {LANDING_DEMO.lead}
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link href={LANDING_DEMO.ctaHref} className="btn w-full sm:w-auto">
                <MessageCircle className="ml-2 h-4 w-4" aria-hidden />
                {LANDING_DEMO.cta}
              </Link>
              <p className="text-sm font-semibold" style={{ color: colors.textMuted }}>
                {LANDING_DEMO.note}
              </p>
            </div>
          </div>

          <div
            className={`${radius.lg} border p-4 sm:p-5`}
            style={{ backgroundColor: colors.surface, borderColor: colors.borderSubtle }}
          >
            <div className="mb-3 flex items-center gap-2 border-b pb-3" style={{ borderColor: colors.borderSubtle }}>
              <span
                className="grid h-8 w-8 place-items-center rounded-full text-sm font-bold text-white"
                style={{ backgroundColor: colors.accent }}
                aria-hidden
              >
                נ
              </span>
              <div className="min-w-0">
                <p className="text-sm font-bold leading-tight" style={{ color: colors.textPrimary }}>
                  נטלי
                </p>
                <p className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: colors.successText }}>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: colors.successText }} aria-hidden />
                  פעילה עכשיו
                </p>
              </div>
              <span
                className={`${radius.pill} mr-auto border px-2.5 py-1 text-[11px] font-bold`}
                style={{ borderColor: colors.borderSubtle, color: colors.textMuted }}
              >
                {LANDING_DEMO.disclaimer}
              </span>
            </div>

            <ul
              ref={threadRef}
              className="grid max-h-72 gap-2.5 overflow-y-auto scroll-smooth pl-1 sm:max-h-80"
              aria-live="polite"
            >
              {messages.map((message, index) => {
                const isNatalie = message.from === "natalie";
                return (
                  <li
                    key={`${index}-${message.text.slice(0, 12)}`}
                    className={`natalie-message-enter flex ${isNatalie ? "justify-start" : "justify-end"}`}
                  >
                    <span
                      className={`${radius.lg} max-w-[85%] px-3.5 py-2.5 text-sm font-medium leading-6`}
                      style={
                        isNatalie
                          ? {
                              backgroundColor: colors.accentMuted,
                              color: colors.textPrimary,
                              border: `1px solid ${colors.borderSubtle}`,
                            }
                          : { backgroundColor: colors.accent, color: "#ffffff" }
                      }
                    >
                      {message.text}
                    </span>
                  </li>
                );
              })}
              {typing ? (
                <li className="flex justify-start" aria-label="נטלי מקלידה">
                  <span
                    className={`${radius.lg} px-3.5 py-3`}
                    style={{ backgroundColor: colors.accentMuted, border: `1px solid ${colors.borderSubtle}` }}
                  >
                    <span className="natalie-typing-dots">
                      <span />
                      <span />
                      <span />
                    </span>
                  </span>
                </li>
              ) : null}
            </ul>

            <div className="mt-4 flex flex-wrap gap-2 border-t pt-4" style={{ borderColor: colors.borderSubtle }}>
              {LANDING_DEMO_PROMPTS.map((item) => {
                const used = usedPrompts.includes(item.prompt);
                return (
                  <button
                    key={item.prompt}
                    type="button"
                    disabled={typing}
                    onClick={() => onPromptClick(item.prompt, item.response)}
                    className={`${radius.pill} border px-3.5 py-2 text-sm font-semibold transition-all duration-200 hover:-translate-y-0.5 disabled:opacity-50`}
                    style={
                      used
                        ? { borderColor: colors.borderSubtle, backgroundColor: colors.accentMuted, color: colors.textMuted }
                        : { borderColor: colors.accent, backgroundColor: colors.surface, color: colors.accent }
                    }
                  >
                    {item.prompt}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
