"use client";

import { useEffect, useRef, useState } from "react";

type ItemState = "hidden" | "loading" | "done";

export function OnboardingChecklist({
  items,
  itemMs,
  onComplete,
}: {
  items: readonly string[];
  itemMs: number;
  onComplete?: () => void;
}) {
  const [states, setStates] = useState<ItemState[]>(() => items.map(() => "hidden"));
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    setStates(items.map(() => "hidden"));
    let cancelled = false;
    const timeouts: number[] = [];

    const schedule = (fn: () => void, delay: number) => {
      timeouts.push(window.setTimeout(fn, delay));
    };

    items.forEach((_, index) => {
      const revealAt = index * itemMs;
      const doneAt = revealAt + Math.round(itemMs * 0.55);

      schedule(() => {
        if (cancelled) return;
        setStates((current) => current.map((state, i) => (i === index ? "loading" : state)));
      }, revealAt);

      schedule(() => {
        if (cancelled) return;
        setStates((current) => current.map((state, i) => (i === index ? "done" : state)));
      }, doneAt);
    });

    schedule(() => {
      if (!cancelled) onCompleteRef.current?.();
    }, items.length * itemMs + 120);

    return () => {
      cancelled = true;
      timeouts.forEach((id) => window.clearTimeout(id));
    };
  }, [itemMs, items]);

  return (
    <ul className="grid gap-3">
      {items.map((item, index) => {
        const state = states[index] ?? "hidden";
        const visible = state !== "hidden";

        return (
          <li
            key={item}
            className={`flex min-h-[3.5rem] items-center gap-3 rounded-2xl border px-4 py-3.5 transition-all duration-500 ${
              visible ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"
            } ${
              state === "done"
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : state === "loading"
                  ? "border-blue-200 bg-blue-50/70 text-slate-700"
                  : "border-transparent bg-transparent text-transparent"
            }`}
            aria-hidden={!visible}
          >
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-all duration-500 ${
                state === "done"
                  ? "scale-100 bg-emerald-600 text-xs font-bold text-white"
                  : state === "loading"
                    ? "animate-spin border-2 border-blue-200 border-t-blue-600 bg-white"
                    : "border border-transparent bg-transparent"
              }`}
              aria-hidden
            >
              {state === "done" ? "✓" : null}
            </span>
            <span className="min-w-0 flex-1 break-words text-base font-semibold leading-6">{item}</span>
          </li>
        );
      })}
    </ul>
  );
}
