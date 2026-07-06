import { config } from "dotenv";
import { join } from "node:path";

config({ path: join(process.cwd(), ".env.prod.local") });

const headers = { Authorization: `Bearer ${process.env.RENDER_API_KEY}` };
const res = await fetch(
  `https://api.render.com/v1/logs?resource=${process.env.RENDER_SERVICE_ID}&limit=100&direction=backward`,
  { headers },
);
const payload = await res.json();
const entries = Array.isArray(payload) ? payload : payload.logs ?? payload.data ?? [];
const lines = [];
for (const entry of entries) {
  const msg = entry.message ?? entry.text ?? entry.msg;
  if (typeof msg === "string") lines.push(msg);
  else if (entry.log) lines.push(String(entry.log));
}

const patterns = [
  { name: "refresh_token", re: /refresh_token/i },
  { name: "access_token", re: /access_token/i },
  { name: "bearer_jwt", re: /\bBearer\s+eyJ[A-Za-z0-9_-]{10,}/ },
  { name: "twilio_auth", re: /TWILIO_AUTH_TOKEN/i },
  { name: "encryption_key", re: /SECRETS_ENCRYPTION_KEY/i },
];

const hits = [];
for (const line of lines) {
  for (const p of patterns) {
    if (p.re.test(line)) {
      hits.push({ pattern: p.name, snippet: line.slice(0, 120) });
      break;
    }
  }
}

const apiBase = "https://ai-office-worker-backend.onrender.com";
const debugNoAuth = await fetch(`${apiBase}/api/debug/gmail/status`);
const debugBadAuth = await fetch(`${apiBase}/api/debug/gmail/status`, {
  headers: { Authorization: "Bearer invalid.token.value" },
});

console.log(
  JSON.stringify(
    {
      renderLogs: { status: res.status, entryCount: entries.length, lineCount: lines.length, hits: hits.slice(0, 5) },
      debugUnauthenticated: debugNoAuth.status,
      debugInvalidToken: debugBadAuth.status,
      sensitiveLogsPass: hits.length === 0,
    },
    null,
    2,
  ),
);
