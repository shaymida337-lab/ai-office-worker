/** Read-only Render logs with ISO timestamps (API requires ISO, not unix). */
const owner = "tea-d86903gg4nts73abte2g";
const svc = "srv-d898po77f7vs73bu01v0";
const key = process.env.RENDER_API_KEY;
if (!key) {
  console.error(JSON.stringify({ error: "RENDER_API_KEY missing" }));
  process.exit(2);
}

const end = new Date();
const start = new Date(Date.now() - 2 * 60 * 60 * 1000);
const url =
  `https://api.render.com/v1/logs?ownerId=${owner}&resource=${svc}` +
  `&limit=100&direction=backward` +
  `&startTime=${encodeURIComponent(start.toISOString())}` +
  `&endTime=${encodeURIComponent(end.toISOString())}`;

const interesting =
  /upload|camera|gmail|scan|ocr|extract|document-review|invoice|timeout|error|fail|ingest|containment|blocked|cmpjd7j7e0001bl5tzv049rxb|שגיאה|POST \/api/i;

const res = await fetch(url, {
  headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
});
const text = await res.text();
let payload;
try {
  payload = JSON.parse(text);
} catch {
  console.log(JSON.stringify({ status: res.status, raw: text.slice(0, 3000) }, null, 2));
  process.exit(1);
}

const entries = payload.logs ?? payload.data ?? (Array.isArray(payload) ? payload : []);
const lines = entries.map((e) => ({
  ts: e.timestamp ?? e.time ?? null,
  msg: String(e.message ?? e.text ?? e.msg ?? e.log ?? ""),
}));

const filtered = lines.filter((l) => interesting.test(l.msg));
// Prefer errors / camera / upload / scan for Shay
const priority = filtered.filter((l) =>
  /error|fail|blocked|containment|camera|upload|cmpjd7j7e|scan_paused|timeout|5\d\d/i.test(l.msg)
);

console.log(
  JSON.stringify(
    {
      status: res.status,
      start: start.toISOString(),
      end: end.toISOString(),
      totalEntries: lines.length,
      filteredCount: filtered.length,
      priorityCount: priority.length,
      priority: priority.slice(0, 60),
      filteredSample: filtered.slice(0, 40),
      hasMore: payload.hasMore ?? null,
    },
    null,
    2
  )
);
