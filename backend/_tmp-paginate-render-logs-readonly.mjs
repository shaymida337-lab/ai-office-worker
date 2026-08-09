/** Paginate Render logs over last 3h for Shay org / camera / upload / scan failures. */
const owner = "tea-d86903gg4nts73abte2g";
const svc = "srv-d898po77f7vs73bu01v0";
const key = process.env.RENDER_API_KEY;
const org = "cmpjd7j7e0001bl5tzv049rxb";

const windowEnd = Date.now();
const windowStart = windowEnd - 3 * 60 * 60 * 1000;

const all = [];
let end = new Date(windowEnd);
const hardStart = new Date(windowStart);

for (let i = 0; i < 25; i++) {
  const start = hardStart;
  const url =
    `https://api.render.com/v1/logs?ownerId=${owner}&resource=${svc}` +
    `&limit=100&direction=backward` +
    `&startTime=${encodeURIComponent(start.toISOString())}` +
    `&endTime=${encodeURIComponent(end.toISOString())}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  const payload = await res.json();
  const logs = payload.logs ?? [];
  if (!logs.length) break;
  for (const e of logs) {
    all.push({ ts: e.timestamp, msg: String(e.message ?? "") });
  }
  const oldest = logs[logs.length - 1]?.timestamp;
  if (!oldest) break;
  const oldestMs = new Date(oldest).getTime();
  if (oldestMs <= windowStart) break;
  end = new Date(oldestMs - 1);
  if (!payload.hasMore && logs.length < 100) break;
}

const uniq = new Map();
for (const l of all) uniq.set(`${l.ts}|${l.msg}`, l);
const lines = [...uniq.values()].sort((a, b) => String(a.ts).localeCompare(String(b.ts)));

const shay = lines.filter((l) => l.msg.includes(org));
const camera = lines.filter((l) => /camera|\/uploads|local.?upload|document-reviews.*post|ingestSource|IMG_/i.test(l.msg));
const errors = lines.filter((l) =>
  /error|fail|blocked|containment|timeout|ECONN|500|403|401/i.test(l.msg)
);
const scanShay = shay.filter((l) => /gmail-scan|gmail-sync|scan_/i.test(l.msg));

console.log(
  JSON.stringify(
    {
      fetched: lines.length,
      windowStart: new Date(windowStart).toISOString(),
      windowEnd: new Date(windowEnd).toISOString(),
      shayCount: shay.length,
      cameraCount: camera.length,
      scanShaySummary: scanShay.map((l) => ({
        ts: l.ts,
        msg: l.msg.length > 400 ? l.msg.slice(0, 400) + "…" : l.msg,
      })),
      cameraLines: camera.slice(0, 40),
      shayErrors: shay.filter((l) => /error|fail|blocked|timeout/i.test(l.msg)).slice(0, 40),
      globalErrorsSample: errors
        .filter((l) => /camera|upload|cmpjd7j7e|containment|ingestion/i.test(l.msg))
        .slice(0, 40),
    },
    null,
    2
  )
);
