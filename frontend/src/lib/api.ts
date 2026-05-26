const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("token");
}

export function clearToken(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem("token");
}

export function isAuthError(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 401 || err.status === 403);
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  if (!token) {
    throw new ApiError("Unauthorized", 401);
  }

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new Error(`API is not reachable at ${API_URL}`);
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError((err as { error?: string }).error ?? "Request failed", res.status);
  }
  return res.json() as Promise<T>;
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
  currency: string;
};

export type GmailStatus = {
  googleConfigured: boolean;
  connected: boolean;
  connectedAt: string | null;
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
