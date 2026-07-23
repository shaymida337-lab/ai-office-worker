"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BusinessOnboardingForm } from "@/components/BusinessOnboardingForm";
import { Nav } from "@/components/Nav";
import { loadOrganizationSettings } from "@/lib/organization/organizationSettingsStore";
import { businessTypeLabel, normalizeEnabledModules, type OrganizationSettings } from "@/lib/business-config";

export default function BusinessSettingsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<OrganizationSettings | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void loadOrganizationSettings()
      .then(setSettings)
      .catch((err) => setMessage(err instanceof Error ? err.message : "טעינת הגדרות העסק נכשלה"));
  }, []);

  return (
    <div className="container">
      <Nav />
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="page-kicker">הגדרות עסק</div>
          <h1>הגדרות עסק ומודולים</h1>
          <p>
            שינוי סוג עסק, גודל, כאב מרכזי ומודולים פעילים. הדשבורד והניווט יתעדכנו לפי הבחירה.
          </p>
          {settings && (
            <p className="mt-2 text-sm text-ink-secondary">
              סוג נוכחי: {businessTypeLabel(settings.businessType)} · מודולים פעילים: {normalizeEnabledModules(settings.enabledModules, settings.businessType).length}
            </p>
          )}
        </div>
        <button className="btn btn-secondary" type="button" onClick={() => router.push("/dashboard/settings")}>
          חזרה להגדרות כלליות
        </button>
      </div>

      {message && <div className="mb-6 rounded-2xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-100">{message}</div>}
      <BusinessOnboardingForm initialSettings={settings} mode="settings" onSaved={setSettings} />
    </div>
  );
}
