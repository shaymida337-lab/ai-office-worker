"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * CTA צף לתחתית המסך במובייל בלבד — מופיע אחרי גלילה מעבר ל-hero.
 * position:fixed כדי לא לייצר CLS; מוסתר לגמרי מ-md ומעלה.
 */
export function StickyMobileCta() {
  // ה-CTA הצף מוסתר כל עוד ה-hero על המסך, ומופיע רק אחרי שה-hero יצא מה-viewport.
  const [heroInView, setHeroInView] = useState(true);
  const [formInView, setFormInView] = useState(false);

  useEffect(() => {
    const supportsIO = typeof IntersectionObserver !== "undefined";

    // מקור האמת: ה-hero. כל עוד חלק ממנו נראה — ה-CTA מוסתר.
    const hero = document.getElementById("hero");
    let heroObserver: IntersectionObserver | null = null;
    let onScroll: (() => void) | null = null;
    if (hero && supportsIO) {
      heroObserver = new IntersectionObserver(
        (entries) => setHeroInView(entries.some((entry) => entry.isIntersecting)),
        { threshold: 0 }
      );
      heroObserver.observe(hero);
    } else {
      // גיבוי אם אין hero/IO: הופעה אחרי גלילה מעבר לגובה מסך אחד.
      onScroll = () => setHeroInView(window.scrollY < window.innerHeight);
      onScroll();
      window.addEventListener("scroll", onScroll, { passive: true });
    }

    // לא מכסים את טופס הלידים — ה-CTA נעלם כשהטופס על המסך
    const form = document.getElementById("trial");
    let formObserver: IntersectionObserver | null = null;
    if (form && supportsIO) {
      formObserver = new IntersectionObserver(
        (entries) => setFormInView(entries.some((entry) => entry.isIntersecting)),
        { threshold: 0.1 }
      );
      formObserver.observe(form);
    }
    return () => {
      if (onScroll) window.removeEventListener("scroll", onScroll);
      heroObserver?.disconnect();
      formObserver?.disconnect();
    };
  }, []);

  const shown = !heroInView && !formInView;

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
