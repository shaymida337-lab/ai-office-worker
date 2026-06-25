"use client";

import { NatalieFirstDayFlow } from "@/components/natalie-first-day";

export default function OnboardingPage() {
  return (
    <main className="min-h-screen overflow-x-hidden bg-white">
      <NatalieFirstDayFlow onComplete={() => {}} />
    </main>
  );
}
