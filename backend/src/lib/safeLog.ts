const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE = /(?:\+972|0)(?:[-\s]?\d){8,10}/g;
const JWT_RE = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const BEARER_RE = /Bearer\s+[A-Za-z0-9._-]+/gi;

const SENSITIVE_KEY_RE =
  /(token|secret|password|authorization|api[_-]?key|refresh|access|credential|cookie|jwt|ocr|prompt|invoice|body)/i;

export function maskEmail(value: string): string {
  return value.replace(EMAIL_RE, (email) => {
    const [local, domain] = email.split("@");
    if (!domain) return "[email]";
    const visible = local.slice(0, Math.min(2, local.length));
    return `${visible}***@${domain}`;
  });
}

export function maskPhone(value: string): string {
  return value.replace(PHONE_RE, (phone) => {
    const digits = phone.replace(/\D/g, "");
    return `***${digits.slice(-4)}`;
  });
}

export function redactSecrets(input: unknown): unknown {
  if (input == null) return input;
  if (typeof input === "string") {
    return maskPhone(maskEmail(input.replace(JWT_RE, "[jwt]").replace(BEARER_RE, "Bearer [redacted]")));
  }
  if (Array.isArray(input)) {
    return input.map((item) => redactSecrets(item));
  }
  if (typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (SENSITIVE_KEY_RE.test(key)) {
        out[key] = "[redacted]";
      } else {
        out[key] = redactSecrets(value);
      }
    }
    return out;
  }
  return input;
}

export function safeLog(message: string, context?: Record<string, unknown>) {
  if (!context) {
    console.log(message);
    return;
  }
  console.log(message, redactSecrets(context));
}

export function safeWarn(message: string, context?: Record<string, unknown>) {
  if (!context) {
    console.warn(message);
    return;
  }
  console.warn(message, redactSecrets(context));
}

export function safeError(message: string, context?: Record<string, unknown>) {
  if (!context) {
    console.error(message);
    return;
  }
  console.error(message, redactSecrets(context));
}
