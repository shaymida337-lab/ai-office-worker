/** Read-only: fetch Render backend logs for last 2h related to upload/scan/ocr. */
const owner = "tea-d86903gg4nts73abte2g";
const svc = "srv-d898po77f7vs73bu01v0";
const key = process.env.RENDER_API_KEY;
if (!key) {
  console.error(JSON.stringify({ error: "RENDER_API_KEY missing" }));
  process.exit(2);
}

const end = Math.floor(Date.now() / 1000);
const start = end - 2 * 3600;
const url =
  `https://api.render.com/v1/logs?ownerId=${owner}&resource=${svc}` +
  `&limit=100&direction=backward&startTime=${start}&endTime=${end}`;

const interesting =
  /upload|camera|gmail|scan|ocr|extract|FinancialDocument|document-review|invoice|timeout|error|fail|ingest|containment|blocked/i;

const res = await fetch(url, {
  headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
});
const text = await res.text();
let payload;
try {
  payload = JSON.parse(text);
} catch {
  console.log(JSON.stringify({ status: res.status, raw: text.slice(0, 2000) }, null, 2));
  process.exit(res.ok ? 0 : 1);
}

const entries = Array.isArray(payload)
  ? payload
  : payload.logs ?? payload.data ?? payload.hits ?? [];

const lines = entries.map((e) => {
  const msg = e.message ?? e.text ?? e.msg ?? e.log ?? JSON.stringify(e);
  const ts = e.timestamp ?? e.time ?? e.createdAt ?? null;
  return { ts, msg: String(msg) };
});

const filtered = lines.filter((l) => interesting.test(l.msg));
console.log(
  JSON.stringify(
    {
      status: res.status,
      start,
      end,
      totalEntries: lines.length,
      filteredCount: filtered.length,
      filtered: filtered.slice(0, 80),
      sampleAll: lines.slice(0, 20),
      hasMore: payload.hasMore ?? payload.next ?? null,
    },
    null,
    2
  )
);
