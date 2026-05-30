import axios, { AxiosError } from "axios";

export type GreenInvoiceEnv = "sandbox" | "production";

export type GreenInvoiceVatType = number;

export type GreenInvoiceClientInfo = {
  name: string;
  email?: string | null;
  taxId?: string | null;
};

export type GreenInvoiceIncomeLineItem = {
  description: string;
  price: number;
  quantity: number;
  vatType: GreenInvoiceVatType;
};

export type GreenInvoiceCreateDocumentParams = {
  documentType: number;
  client: GreenInvoiceClientInfo;
  income: GreenInvoiceIncomeLineItem[];
  currency?: string;
  language?: "he" | "en";
  date?: string;
};

export type GreenInvoiceConnectionResult =
  | { success: true }
  | { success: false; error: string };

export type GreenInvoiceCreatedDocument = {
  id?: string;
  documentId?: string;
  number?: number;
  url?: string;
  pdfUrl?: string;
  raw: unknown;
};

const REQUEST_TIMEOUT_MS = 15_000;

export function getBaseUrl(env: GreenInvoiceEnv) {
  return env === "production"
    ? "https://api.greeninvoice.co.il/api/v1"
    : "https://sandbox.d.greeninvoice.co.il/api/v1";
}

export async function getToken(
  apiKeyId: string,
  apiSecret: string,
  env: GreenInvoiceEnv
): Promise<string> {
  try {
    const response = await axios.post(
      `${getBaseUrl(env)}/account/token`,
      { id: apiKeyId, secret: apiSecret },
      { timeout: REQUEST_TIMEOUT_MS }
    );

    const token = extractToken(response.data);
    if (!token) {
      throw new Error("Green Invoice token response did not include a JWT token");
    }
    return token;
  } catch (err) {
    throw new Error(toGreenInvoiceErrorMessage(err, "Green Invoice authentication failed"));
  }
}

export async function testConnection(
  apiKeyId: string,
  apiSecret: string,
  env: GreenInvoiceEnv
): Promise<GreenInvoiceConnectionResult> {
  try {
    await getToken(apiKeyId, apiSecret, env);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Green Invoice connection failed",
    };
  }
}

export async function createDocument(
  apiKeyId: string,
  apiSecret: string,
  env: GreenInvoiceEnv,
  params: GreenInvoiceCreateDocumentParams
): Promise<GreenInvoiceCreatedDocument> {
  const token = await getToken(apiKeyId, apiSecret, env);
  const payload = toCreateDocumentPayload(params);

  try {
    const response = await axios.post(`${getBaseUrl(env)}/documents`, payload, {
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    return normalizeCreatedDocument(response.data);
  } catch (err) {
    throw new Error(toGreenInvoiceErrorMessage(err, "Green Invoice document creation failed"));
  }
}

function toCreateDocumentPayload(params: GreenInvoiceCreateDocumentParams) {
  return {
    type: params.documentType,
    lang: params.language ?? "he",
    currency: params.currency ?? "ILS",
    date: params.date,
    client: {
      name: params.client.name,
      ...(params.client.email ? { emails: [params.client.email] } : {}),
      ...(params.client.taxId ? { taxId: params.client.taxId } : {}),
    },
    income: params.income.map((item) => ({
      description: item.description,
      price: item.price,
      quantity: item.quantity,
      vatType: item.vatType,
      currency: params.currency ?? "ILS",
    })),
  };
}

function extractToken(data: unknown): string | null {
  if (!isRecord(data)) return null;
  const token = data.token ?? data.jwt ?? data.accessToken;
  return typeof token === "string" && token.length > 0 ? token : null;
}

function normalizeCreatedDocument(data: unknown): GreenInvoiceCreatedDocument {
  const record = isRecord(data) ? data : {};
  const files = isRecord(record.files) ? record.files : {};
  const downloadLinks = isRecord(files.downloadLinks) ? files.downloadLinks : {};
  const pdfUrl = firstString([
    record.pdfUrl,
    record.pdfURL,
    record.url,
    files.url,
    files.pdfUrl,
    downloadLinks.he,
    downloadLinks.en,
  ]);

  return {
    id: firstString([record.id]),
    documentId: firstString([record.documentId]),
    number: typeof record.number === "number" ? record.number : undefined,
    url: firstString([record.url]),
    pdfUrl,
    raw: data,
  };
}

function toGreenInvoiceErrorMessage(err: unknown, fallback: string) {
  if (axios.isAxiosError(err)) {
    return describeAxiosError(err, fallback);
  }
  return err instanceof Error ? err.message : fallback;
}

function describeAxiosError(err: AxiosError, fallback: string) {
  if (err.response) {
    const details = extractApiErrorDetails(err.response.data);
    const authHint = err.response.status === 401 || err.response.status === 403
      ? " Check the Green Invoice API key id, secret, and environment."
      : "";
    return `${fallback}: Green Invoice returned ${err.response.status}${details ? ` - ${details}` : ""}.${authHint}`;
  }

  if (err.code === "ECONNABORTED") {
    return `${fallback}: request timed out after ${REQUEST_TIMEOUT_MS}ms`;
  }

  return `${fallback}: ${err.message || "network request failed"}`;
}

function extractApiErrorDetails(data: unknown) {
  if (typeof data === "string") return data;
  if (!isRecord(data)) return "";
  return firstString([data.error, data.message, data.description]) ?? JSON.stringify(data);
}

function firstString(values: unknown[]) {
  return values.find((value): value is string => typeof value === "string" && value.length > 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
