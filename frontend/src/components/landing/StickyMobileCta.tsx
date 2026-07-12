"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * CTA צף לתחתית המסך במובייל בלבד — מופיע אחרי גלילה מעבר ל-hero.
 * position:fixed כדי לא לייצר CLS; מוסתר לגמרי מ-md ומעלה.
 */
export function StickyMobileCta() {
  const [visible, setVisible] = useState(false);
  const [formInView, setFormInView] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 560);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    // לא מכסים את טופס הלידים — ה-CTA נעלם כשהטופס על המסך
    const form = document.getElementById("trial");
    let observer: IntersectionObserver | null = null;
    if (form && typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver(
        (entries) => setFormInView(entries.some((entry) => entry.isIntersecting)),
        { threshold: 0.1 }
      );
      observer.observe(form);
    }
    return () => {
      window.removeEventListener("scroll", onScroll);
      observer?.disconnect();
    };
  }, []);

  const shown = visible && !formInView;

  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-40 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] pt-2 transition-all duration-300 md:hidden ${
        shown ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-full opacity-0"
      }`}
      style={{
        background: "linear-gradient(to top, rgba(244,246,251,0.97) 65%, rgba(244,246,251,0))",
      }}
      aria-hidden={!shown}
    >
      <Link
        href="/natalie"
        className="btn w-full shadow-[0_10px_30px_rgba(29,91,255,0.35)]"
        tabIndex={shown ? 0 : -1}
      >
        נסו את נטלי — דמו חי
      </Link>
    </div>
  );
}
