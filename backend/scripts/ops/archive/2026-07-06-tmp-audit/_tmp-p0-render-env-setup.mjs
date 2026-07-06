/**
 * One-off: set P0 security env vars on Render. Never logs secret values.
 */
import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: true });
}

const KEYS = ["SECRETS_ENCRYPTION_KEY", "LEADS_WEBHOOK_SECRET"];
const BASE64URL = /^[A-Za-z0-9_-]+$/;

function generateSecret() {
  return randomBytes(32).toString("base64url");
}

function safeFormatCheck(key, value) {
  if (!value || typeof value !== "string") {
    return { ok: false, reason: "empty or non-string" };
  }
  if (value.length < 32) {
    return { ok: false, reason: "length below minimum" };
  }
  if (/\s/.test(value)) {
    return { ok: false, reason: "contains whitespace" };
  }
  if (!BASE64URL.test(value)) {
    return { ok: false, reason: "not base64url-safe charset" };
  }
  if (key === "SECRETS_ENCRYPTION_KEY" && value.length < 43) {
    return { ok: false, reason: "encryption key too short for 32-byte entropy" };
  }
  return { ok: true, reason: "base64url, 32+ random bytes, no whitespace" };
}

async function renderFetch(path, options = {}) {
  const apiKey = process.env.RENDER_API_KEY;
  const serviceId = process.env.RENDER_SERVICE_ID;
  if (!apiKey || !serviceId) {
    throw new Error("RENDER_API_KEY or RENDER_SERVICE_ID missing in .env.prod.local");
  }
  const url = `https://api.render.com/v1/services/${serviceId}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    throw new Error(`Render API ${options.method ?? "GET"} ${path} failed: ${res.status}`);
  }
  return body;
}

async function listEnvVars() {
  const out = new Map();
  let cursor = null;
  do {
    const qs = new URLSearchParams({ limit: "100" });
    if (cursor) qs.set("cursor", cursor);
    const data = await renderFetch(`/env-vars?${qs}`);
    const items = Array.isArray(data) ? data : [];
    for (const item of items) {
      const envVar = item.envVar ?? item;
      if (envVar?.key) out.set(envVar.key, envVar.value ?? "");
    }
    cursor = items.at(-1)?.cursor ?? null;
  } while (cursor);
  return out;
}

async function upsertEnvVar(key, value) {
  const encodedKey = encodeURIComponent(key);
  await renderFetch(`/env-vars/${encodedKey}`, {
    method: "PUT",
    body: JSON.stringify({ value }),
  });
}

async function main() {
  const existing = await listEnvVars();
  const generated = {};

  for (const key of KEYS) {
    if (!existing.has(key) || !existing.get(key)) {
      generated[key] = generateSecret();
      await upsertEnvVar(key, generated[key]);
    }
  }

  const confirmed = await listEnvVars();
  const report = { action: Object.keys(generated).length ? "created" : "already_present", vars: {} };

  for (const key of KEYS) {
    const value = confirmed.get(key) ?? "";
    const fmt = safeFormatCheck(key, value);
    report.vars[key] = {
      exists: Boolean(value),
      length: value.length,
      safeFormat: fmt.ok,
      formatNote: fmt.reason,
    };
  }

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
