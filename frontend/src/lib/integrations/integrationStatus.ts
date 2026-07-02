export type IntegrationConnectionState =
  | "connected"
  | "disconnected"
  | "connecting"
  | "disabled";

export type IntegrationSyncState =
  | "idle"
  | "syncing"
  | "warning"
  | "error";

export type IntegrationHealthState =
  | "healthy"
  | "warning"
  | "error"
  | "unknown";

export type IntegrationStatusTone = "success" | "warn" | "danger" | "info";

export type IntegrationStatusBadge = {
  key: string;
  label: string;
  tone: IntegrationStatusTone;
};

export type IntegrationMetric = {
  key: string;
  label: string;
  value: string;
};

export type IntegrationDetail = {
  key: string;
  label: string;
  value: string;
};

export type IntegrationStatusModel = {
  connectionState: IntegrationConnectionState;
  syncState: IntegrationSyncState;
  healthState: IntegrationHealthState;
  title: string;
  description: string;
  badges: IntegrationStatusBadge[];
  metrics: IntegrationMetric[];
  details: IntegrationDetail[];
};

type BuildGmailStatusInput = {
  statusKnown: boolean;
  statusStale: boolean;
  connected: boolean;
  connectionAmbiguous?: boolean;
  connecting: boolean;
  scanRunning: boolean;
  hasWarning: boolean;
  hasError: boolean;
  reconnectRequired: boolean;
  gmailAddress: string | null;
  organizationName: string;
  lastSuccessfulScanAt: string | null;
  lastSyncAt: string | null;
  scannedEmails: number | null;
  extractedDocuments: number | null;
  scanStatusLabel: string;
  connectedSince: string | null;
  scopesSummary: string | null;
  lastOauthAt: string | null;
  lastScanDurationLabel: string | null;
  lastSyncDurationLabel: string | null;
  syncMessage?: string | null;
};

function dateValue(value: string | null): string {
  if (!value) return "לא זמין";
  return new Date(value).toLocaleString("he-IL");
}

function metricValue(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  return value.toLocaleString("he-IL");
}

export function buildGmailIntegrationStatus(input: BuildGmailStatusInput): IntegrationStatusModel {
  if (!input.statusKnown) {
    return {
      connectionState: "connecting",
      syncState: "idle",
      healthState: "unknown",
      title: "בודק חיבור Gmail...",
      description: "טוען מצב חיבור כדי להציג נתונים מדויקים.",
      badges: [
        { key: "sync", label: "בודק סטטוס", tone: "info" },
      ],
      metrics: [],
      details: [],
    };
  }

  if (input.connectionAmbiguous) {
    return {
      connectionState: "connecting",
      syncState: "idle",
      healthState: "unknown",
      title: "נמצאו מסמכים מ-Gmail",
      description: "מצאתי מסמכים מהאימייל שלך. מוודאת שהחיבור פעיל.",
      badges: [{ key: "sync", label: "בודק חיבור", tone: "info" }],
      metrics: [
        { key: "docs", label: "מסמכים", value: metricValue(input.extractedDocuments) },
      ],
      details: [],
    };
  }

  if (input.connecting) {
    return {
      connectionState: "connecting",
      syncState: "syncing",
      healthState: "unknown",
      title: "מחבר את Gmail...",
      description: "פתחנו חלון הרשאה. נא להשלים את ההתחברות, אין צורך ללחוץ שוב.",
      badges: [
        { key: "connection", label: "מתחבר", tone: "info" },
        { key: "sync", label: "בהמתנה להרשאה", tone: "info" },
      ],
      metrics: [
        { key: "email", label: "חשבון", value: input.gmailAddress ?? "ממתין להרשאה" },
      ],
      details: [
        { key: "scopes", label: "Scopes", value: input.scopesSummary ?? "ממתין להרשאה" },
      ],
    };
  }

  if (!input.connected) {
    return {
      connectionState: "disconnected",
      syncState: "idle",
      healthState: "unknown",
      title: "Gmail לא מחובר",
      description: "חיבור Gmail מאפשר לנטלי לסרוק מסמכים באופן אוטומטי ולהציג סטטוס אמין בזמן אמת.",
      badges: [],
      metrics: [],
      details: [],
    };
  }

  const warning = input.hasWarning || input.reconnectRequired;
  const error = input.hasError;
  const healthState: IntegrationHealthState = error ? "error" : warning ? "warning" : "healthy";
  const syncState: IntegrationSyncState = input.scanRunning ? "syncing" : error ? "error" : warning ? "warning" : "idle";

  const statusLabel = input.syncMessage
    ?? (input.scanRunning
      ? "סורק מיילים..."
      : error
        ? "החיבור נכשל"
        : warning
          ? input.reconnectRequired
            ? "נדרש חיבור מחדש ל-Gmail (OAuth פג תוקף או הרשאות)"
            : "יש לשים לב"
          : "מערכת תקינה");

  return {
    connectionState: "connected",
    syncState,
    healthState,
    title: warning || error ? "Gmail מחובר" : "Gmail מחובר",
    description: statusLabel,
    badges: [
      { key: "connection", label: "מחובר", tone: "success" },
      {
        key: "health",
        label: input.scanRunning ? "סורק כעת" : error ? "תקלה" : warning ? "אזהרה" : "תקין",
        tone: error ? "danger" : warning ? "warn" : "success",
      },
      ...(input.statusStale ? [{ key: "stale", label: "מציג מצב אחרון", tone: "info" as const }] : []),
    ],
    metrics: [
      { key: "email", label: "חשבון Gmail", value: input.gmailAddress ?? "לא זמין" },
      { key: "lastScan", label: "סריקה אחרונה", value: dateValue(input.lastSuccessfulScanAt) },
      { key: "docs", label: "מסמכים", value: metricValue(input.extractedDocuments) },
    ],
    details: [
      { key: "org", label: "ארגון מחובר", value: input.organizationName },
      { key: "lastSync", label: "סנכרון אחרון", value: dateValue(input.lastSyncAt) },
      { key: "emails", label: "מיילים שנסרקו", value: metricValue(input.scannedEmails) },
      { key: "status", label: "מצב סריקה", value: statusLabel },
      { key: "connectedSince", label: "מחובר מאז", value: dateValue(input.connectedSince) },
      { key: "scopes", label: "Scopes שניתנו", value: input.scopesSummary ?? "לא זמין" },
      { key: "lastOauth", label: "OAuth אחרון", value: dateValue(input.lastOauthAt) },
      { key: "scanDuration", label: "משך סריקה אחרון", value: input.lastScanDurationLabel ?? "לא זמין" },
      { key: "syncDuration", label: "משך סנכרון אחרון", value: input.lastSyncDurationLabel ?? "לא זמין" },
      {
        key: "syncHealth",
        label: "בריאות סנכרון",
        value: error ? "שגיאה" : warning ? "אזהרה" : "תקין",
      },
    ],
  };
}
