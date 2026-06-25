"use client";

import { NatalieFirstDayFlow } from "@/components/natalie-first-day";

export default function OnboardingPage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-blue-50/60 via-slate-50 to-white">
      <NatalieFirstDayFlow onComplete={() => {}} />
    </main>
  );
}
