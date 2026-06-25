export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

const AUTH_STORAGE_KEYS = ["token", "authToken", "accessToken"] as const;

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  const token = localStorage.getItem("token")?.trim();
  return token || null;
}

export function clearAllAuthTokens(): void {
  if (typeof window === "undefined") return;
  for (const key of AUTH_STORAGE_KEYS) {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  }
}

export function clearToken(): void {
  clearAllAuthTokens();
}

export function isAuthError(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 401 || err.status === 403);
}

type ApiFetchInit = RequestInit & { timeoutMs?: number };

export async function apiFetch<T>(path: string, init?: ApiFetchInit): Promise<T> {
  const token = getToken();
  if (!token) {
    throw new ApiError("צריך להתחבר כדי להמשיך", 401);
  }

  let res: Response;
  const url = `${API_URL}${path}`;
  const { timeoutMs, ...fetchInit } = init ?? {};
  const isFormData = typeof FormData !== "undefined" && fetchInit.body instanceof FormData;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs ?? 15000);
  try {
    res = await fetch(url, {
      ...fetchInit,
      cache: fetchInit.cache ?? "no-store",
      credentials: fetchInit.credentials ?? "include",
      signal: fetchInit.signal ?? controller.signal,
      headers: {
        ...(!isFormData ? { "Content-Type": "application/json" } : {}),
        "Cache-Control": "no-cache",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...fetchInit.headers,
      },
    });
  } catch (err) {
    const message = err instanceof DOMException && err.name === "AbortError"
      ? "השרת לא ענה בזמן. נסה שוב בעוד רגע."
      : "אי אפשר להתחבר לשרת כרגע. בדוק שהמערכת פעילה ונסה שוב.";
    console.error("[apiFetch]", message, err);
    throw new Error(message);
  } finally {
    window.clearTimeout(timeout);
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    const serverMessage = (err as { error?: string }).error ?? `הבקשה נכשלה עם קוד ${res.status}`;
    if (res.status === 401) {
      clearAllAuthTokens();
      window.location.href = "/login?reason=session_expired";
      throw new ApiError("פג תוקף ההתחברות. יש להתחבר מחדש.", 401);
    }
    console.error("[apiFetch]", serverMessage);
    throw new ApiError(serverMessage, res.status);
  }
  return res.json() as Promise<T>;
}

export type IssueDraftResponse = {
  success: boolean;
  documentId?: string;
  document?: {
    id?: string;
    documentId?: string;
    number?: number;
    url?: string;
    pdfUrl?: string;
  };
  error?: string;
};

export async function issueDraft(draftId: string): Promise<IssueDraftResponse> {
  try {
    return await apiFetch<IssueDraftResponse>(`/api/natalie/invoice-drafts/${draftId}/issue`, {
      method: "POST",
      timeoutMs: 60000,
    });
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "הנפקת הטיוטה נכשלה",
    };
  }
}

export type DashboardStats = {
  moneyToPay: number;
  moneyToReceive: number;
  pendingInvoices: number;
  missingInvoicesCount: number;
  upcomingPaymentsCount: number;
  openTasks: number;
  unreadAlerts: number;
  businessHealthScore: number;
  overdueCustomerInvoices: number;
  overdueSupplierPayments: number;
  hoursSavedThisWeek: number;
  supplierPaymentsCount: number;
  totalInvoices: number;
  unpaidPayments: number;
  paidPayments: number;
  scansCompleted: number;
  driveUploads: number;
  documentsInDrive?: number;
  invoicesFromGmail?: number;
  invoicesFromWhatsApp?: number;
  clients: number;
  suspiciousPaymentsCount: number;
  sheetsReconciliation?: {
    dbCount: number;
    googleSheetCount: number;
    difference: number;
    warning: boolean;
    missingRowsCount: number;
    duplicateRowsCount: number;
    lastSyncTime: string | null;
    spreadsheetUrl: string;
  } | null;
  currency: string;
};

export type GmailStatus = {
  googleConfigured: boolean;
  connected: boolean;
  connectedAt: string | null;
  reconnectRequired?: boolean;
  missingDriveScopes?: string[];
};

export type Payment = {
  id: string;
  supplier: string;
  amount: number;
  currency: string;
  date: string;
  dueDate: string | null;
  paid: boolean;
  documentLink: string | null;
  invoiceLink: string | null;
  emailSender: string | null;
  missingInvoice: boolean;
  paymentRequired: boolean;
  subject: string | null;
  sources?: string[];
  duplicateDetected?: boolean;
  duplicateReason?: string | null;
  firstSource?: string | null;
  lastSource?: string | null;
  sourceCount?: number;
  firstSeenAt?: string | null;
  lastSeenAt?: string | null;
};

export type Task = {
  id: string;
  title: string;
  supplier: string | null;
  priority: string;
  status: string;
  dueDate: string | null;
  updatedAt: string;
};

export type CustomerInvoice = {
  id: string;
  customer: string;
  amount: number;
  currency: string;
  issueDate: string;
  dueDate: string | null;
  paid: boolean;
  reminderSentAt: string | null;
  notes: string | null;
};

export type SocialDraft = {
  id: string;
  platform: string;
  topic: string;
  content: string;
  status: string;
  createdAt: string;
};

export type BillingSubscriptionState =
  | "trial"
  | "trial_ending"
  | "active"
  | "past_due"
  | "restricted"
  | "paused"
  | "cancelled"
  | "reactivated";

export type BillingSummaryResponse = {
  organizationName: string;
  planName: string | null;
  trialEndsAt: string | null;
  nextBillingAt: string | null;
  readOnly: boolean;
  status: BillingSubscriptionState;
};

export type BillingPlanResponse = {
  id: "starter" | "growth";
  name: string;
  priceMonthly: number;
  description: string;
  highlights: string[];
  recommended?: boolean;
  available?: boolean;
};

export type BillingHistoryResponse = {
  id: string;
  date: string;
  amount: number;
  status: "paid" | "pending";
  description: string;
};

export type BillingValueMetricResponse = {
  id: "documents" | "tasks" | "payments" | "hours";
  label: string;
  value: string;
  helper: string;
};

export async function getBillingSummary() {
  return apiFetch<BillingSummaryResponse>("/api/billing/subscription-status");
}

export async function getBillingPlans() {
  return apiFetch<BillingPlanResponse[]>("/api/billing/plans");
}

export async function getBillingHistory() {
  return apiFetch<BillingHistoryResponse[]>("/api/billing/history");
}

export async function getBillingValueReport() {
  return apiFetch<BillingValueMetricResponse[]>("/api/billing/value-report");
}

export async function createBillingCheckoutSession(planId: "starter" | "growth") {
  return apiFetch<{ sessionId: string; url: string | null }>("/api/billing/checkout-session", {
    method: "POST",
    body: JSON.stringify({ planId }),
  });
}

export async function createBillingPaymentMethodSession() {
  return apiFetch<{ sessionId: string; url: string | null }>("/api/billing/payment-method/session", {
    method: "POST",
  });
}

export async function runBillingSubscriptionAction(action: "pause" | "cancel" | "reactivate") {
  return apiFetch<BillingSummaryResponse>("/api/billing/subscription/action", {
    method: "POST",
    body: JSON.stringify({ action }),
  });
}
