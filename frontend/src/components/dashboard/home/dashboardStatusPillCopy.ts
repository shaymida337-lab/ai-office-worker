import type { DashboardSyncState } from "@/lib/dashboard/dashboardSyncState";

const ENGLISH_PATTERN = /[A-Za-z]{3,}/;

export function buildDashboardStatusPillLabel(
  state: DashboardSyncState,
  loading?: boolean
): string {
  if (loading) {
    return "⚪ בודקת מצב...";
  }

  switch (state.status) {
    case "CONNECTED": {
      const lastScan = state.healthRows.find((row) => row.key === "lastScan")?.value;
      const updated =
        lastScan && lastScan !== "לא זמין"
          ? lastScan.startsWith("לפני")
            ? `עודכן ${lastScan}`
            : `עודכן ${lastScan}`
          : "עודכן לאחרונה";
      return `🟢 מחובר ומסונכרן · ${updated}`;
    }
    case "SYNCING": {
      const found = state.scanBanner?.found;
      const scanned = state.scanBanner?.scanned;
      const count = found ?? scanned;
      const docs =
        count != null && count > 0
          ? `${count.toLocaleString("he-IL")} מסמכים`
          : state.healthRows.find((row) => row.key === "documents")?.value?.includes("נסרקו")
            ? state.healthRows.find((row) => row.key === "documents")!.value.replace(" נסרקו", "")
            : "…";
      return `🔵 סורקת מיילים… · ${docs}`;
    }
    case "WARNING":
      return "🟡 יש משהו לבדוק";
    case "ERROR":
      return "🔴 צריך טיפול";
    case "CHECKING":
    default:
      return "⚪ מציג מידע אחרון";
  }
}

export function dashboardStatusPillHasEnglish(text: string): boolean {
  return ENGLISH_PATTERN.test(text.replace(/Gmail/g, "").replace(/…/g, ""));
}

export const MODAL_HEALTH_LABEL: Record<string, string> = {
  gmail: "Gmail",
  lastScan: "סריקה אחרונה",
  documents: "מסמכים",
  ai: "AI",
  backend: "שרת",
};
