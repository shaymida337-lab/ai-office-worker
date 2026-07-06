import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "crypto";
import { config } from "./config.js";
import { isProduction } from "./productionGuard.js";

const PREFIX = "enc:v1:";
const ALGO = "aes-256-gcm";

function encryptionKey(): Buffer | null {
  const raw = process.env.SECRETS_ENCRYPTION_KEY?.trim() || config.secrets.encryptionKey?.trim();
  if (!raw) return null;
  return createHash("sha256").update(raw).digest();
}

export function isEncryptedSecret(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(PREFIX);
}

export function encryptSecret(value: string | null | undefined): string | null | undefined {
  if (!value) return value;
  if (isEncryptedSecret(value)) return value;

  const key = encryptionKey();
  if (!key) {
    if (isProduction()) {
      throw new Error("SECRETS_ENCRYPTION_KEY is required in production");
    }
    return value;
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${Buffer.concat([iv, tag, encrypted]).toString("base64url")}`;
}

export function decryptSecret(value: string | null | undefined): string | null | undefined {
  if (!value || !isEncryptedSecret(value)) return value;

  const key = encryptionKey();
  if (!key) {
    throw new Error("SECRETS_ENCRYPTION_KEY is required to decrypt stored secrets");
  }

  const payload = Buffer.from(value.slice(PREFIX.length), "base64url");
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const encrypted = payload.subarray(28);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

export function secretsEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
