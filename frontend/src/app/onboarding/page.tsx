"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BusinessOnboardingForm } from "@/components/BusinessOnboardingForm";
import { Nav } from "@/components/Nav";
import { apiFetch } from "@/lib/api";
import type { OrganizationSettings } from "@/lib/business-config";

export default function OnboardingPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<OrganizationSettings | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    apiFetch<OrganizationSettings>("/api/organization/settings")
      .then(setSettings)
      .catch((err) => setMessage(err instanceof Error ? err.message : "טעינת ההגדרות נכשלה"));
  }, []);

  return (
    <div className="container">
      <Nav />
      <div className="mb-8">
        <div className="page-kicker">Business onboarding</div>
        <h1>התאמת AI Office Worker לעסק שלך</h1>
        <p>שלושה צעדים קצרים: סוג עסק, גודל העסק, והכאב המרכזי. משם נבנה דשבורד ומודולים מומלצים.</p>
      </div>

      {message && <div className="mb-6 rounded-2xl border border-accent-primary/30 bg-accent-primary/10 p-4 text-sm text-ink-primary">{message}</div>}
      <BusinessOnboardingForm initialSettings={settings} mode="onboarding" onSaved={() => router.push("/dashboard")} />
    </div>
  );
}
