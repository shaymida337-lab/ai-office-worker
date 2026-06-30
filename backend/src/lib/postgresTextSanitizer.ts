const NUL = "\u0000";
const NUL_RE = /\u0000/g;

export function stripNulBytesFromString(value: string): string {
  return value.includes(NUL) ? value.replace(NUL_RE, "") : value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function stripNulBytesDeep<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return stripNulBytesFromString(value) as T;
  if (typeof value !== "object") return value;
  if (value instanceof Date) return value;
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value)) {
    return value.map((item) => stripNulBytesDeep(item)) as T;
  }
  if (!isPlainObject(value)) return value;

  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    result[key] = stripNulBytesDeep(entry);
  }
  return result as T;
}

export function sanitizePrismaWriteData<T>(data: T): T {
  return stripNulBytesDeep(data);
}
