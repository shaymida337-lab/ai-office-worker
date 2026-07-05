export type ClientRecord = {
  id: string;
  name: string;
  email: string | null;
  whatsappNumber: string | null;
  color?: string | null;
  gmailConnected?: boolean;
  invoiceSheetUrl?: string | null;
  taskSheetUrl?: string | null;
  driveFolderUrl?: string | null;
};

export type ClientFormValues = {
  name: string;
  email: string;
  whatsappNumber: string;
  color?: string;
  invoiceSheetUrl?: string;
  taskSheetUrl?: string;
  driveFolderUrl?: string;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PLACEHOLDER_EMAIL_SUFFIXES = ["@scheduling.local", "@whatsapp.local"] as const;

export function isPlaceholderClientEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  return PLACEHOLDER_EMAIL_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

export function validateClientEmail(email: string): string | null {
  const trimmed = email.trim();
  if (!trimmed) return null;
  if (!EMAIL_PATTERN.test(trimmed)) return "כתובת המייל לא תקינה";
  if (isPlaceholderClientEmail(trimmed)) return "לא ניתן להשתמש בכתובת מייל זמנית";
  return null;
}

export function validateClientForm(
  values: ClientFormValues,
  options?: { requireContact?: boolean }
): { ok: true } | { ok: false; error: string } {
  const name = values.name.trim();
  if (!name) {
    return { ok: false, error: "שם לקוח נדרש" };
  }

  const emailError = validateClientEmail(values.email);
  if (emailError) {
    return { ok: false, error: emailError };
  }

  const hasEmail = Boolean(values.email.trim());
  const hasPhone = Boolean(values.whatsappNumber.trim());
  if (options?.requireContact && !hasEmail && !hasPhone) {
    return { ok: false, error: "יש להזין מייל או מספר וואטסאפ" };
  }

  return { ok: true };
}

export function buildClientCreatePayload(values: ClientFormValues): Record<string, string> {
  const validation = validateClientForm(values);
  if (!validation.ok) {
    throw new Error(validation.error);
  }

  const payload: Record<string, string> = {
    name: values.name.trim(),
    color: values.color?.trim() || "#3B82F6",
  };

  const email = values.email.trim().toLowerCase();
  if (email) payload.email = email;

  const whatsappNumber = values.whatsappNumber.trim();
  if (whatsappNumber) payload.whatsappNumber = whatsappNumber;

  const invoiceSheetUrl = values.invoiceSheetUrl?.trim();
  if (invoiceSheetUrl) payload.invoiceSheetUrl = invoiceSheetUrl;

  const taskSheetUrl = values.taskSheetUrl?.trim();
  if (taskSheetUrl) payload.taskSheetUrl = taskSheetUrl;

  const driveFolderUrl = values.driveFolderUrl?.trim();
  if (driveFolderUrl) payload.driveFolderUrl = driveFolderUrl;

  return payload;
}

export function buildClientUpdatePayload(values: ClientFormValues): Record<string, string> {
  const validation = validateClientForm(values);
  if (!validation.ok) {
    throw new Error(validation.error);
  }

  const payload: Record<string, string> = {
    name: values.name.trim(),
    email: values.email.trim().toLowerCase(),
    whatsappNumber: values.whatsappNumber.trim(),
  };

  if (values.color?.trim()) payload.color = values.color.trim();
  if (values.invoiceSheetUrl !== undefined) payload.invoiceSheetUrl = values.invoiceSheetUrl.trim();
  if (values.taskSheetUrl !== undefined) payload.taskSheetUrl = values.taskSheetUrl.trim();
  if (values.driveFolderUrl !== undefined) payload.driveFolderUrl = values.driveFolderUrl.trim();

  return payload;
}

export function formatClientEmailDisplay(email: string | null | undefined): string {
  const trimmed = email?.trim();
  if (!trimmed || isPlaceholderClientEmail(trimmed)) return "לא מוגדר";
  return trimmed;
}

export function clientToFormValues(client: Pick<ClientRecord, "name" | "email" | "whatsappNumber" | "color" | "invoiceSheetUrl" | "taskSheetUrl" | "driveFolderUrl">): ClientFormValues {
  const email = client.email?.trim();
  return {
    name: client.name,
    email: email && !isPlaceholderClientEmail(email) ? email : "",
    whatsappNumber: client.whatsappNumber ?? "",
    color: client.color ?? "#3B82F6",
    invoiceSheetUrl: client.invoiceSheetUrl ?? "",
    taskSheetUrl: client.taskSheetUrl ?? "",
    driveFolderUrl: client.driveFolderUrl ?? "",
  };
}
