"use client";

import { NatalieFirstDayFlow } from "@/components/natalie-first-day";

export default function OnboardingPage() {
  return (
    <main className="flex min-h-[100svh] min-h-[100dvh] flex-col overflow-x-hidden bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] pt-[max(0.75rem,env(safe-area-inset-top,0px))]">
      <div className="flex w-full min-h-0 flex-1 flex-col items-center justify-center">
        <NatalieFirstDayFlow onComplete={() => {}} />
      </div>
    </main>
  );
}
