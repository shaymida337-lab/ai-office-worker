"use client";

import { useSystemDeployStatus } from "@/hooks/useSystemDeployStatus";

export function SystemDeployBanner() {
  const { bannerMessage, status } = useSystemDeployStatus();

  if (!bannerMessage || status.state === "checking") {
    return null;
  }

  return (
    <div
      role="status"
      className="border-b border-amber-300 bg-amber-50 px-4 py-3 text-center text-sm font-semibold text-amber-950"
    >
      {bannerMessage}
    </div>
  );
}
