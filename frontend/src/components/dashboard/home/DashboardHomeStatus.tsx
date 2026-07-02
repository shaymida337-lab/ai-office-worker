"use client";

import { useState } from "react";
import type { DashboardSyncState } from "@/lib/dashboard/dashboardSyncState";
import { DashboardStatusDetailsModal } from "./DashboardStatusDetailsModal";
import { DashboardStatusPill } from "./DashboardStatusPill";

export function DashboardHomeStatus({
  state,
  loading,
  onConnectGmail,
  onRetrySync,
  onOpenSettings,
}: {
  state: DashboardSyncState;
  loading?: boolean;
  onConnectGmail: () => void;
  onRetrySync: () => void;
  onOpenSettings: () => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);

  return (
    <>
      <DashboardStatusPill
        state={state}
        loading={loading}
        onOpenDetails={() => setDetailsOpen(true)}
      />
      <DashboardStatusDetailsModal
        open={detailsOpen}
        state={state}
        loading={loading}
        onClose={() => setDetailsOpen(false)}
        onConnectGmail={onConnectGmail}
        onRetrySync={onRetrySync}
        onOpenSettings={onOpenSettings}
      />
    </>
  );
}
