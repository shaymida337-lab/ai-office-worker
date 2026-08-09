/**
 * Fetch recent Render logs looking for rnet_completion_trace / invoice-completion.
 */
import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const BACKEND = process.env.RENDER_SERVICE_ID || "srv-d898po77f7vs73bu01v0";
const OWNER = process.env.RENDER_OWNER_ID || "tea-d86903gg4nts73abte2g";
const apiKey = process.env.RENDER_API_KEY?.trim();
if (!apiKey) process.exit(1);

const end = Math.floor(Date.now() / 1000);
const start = end - 20 * 60;
const url =
  `https://api.render.com/v1/logs?ownerId=${OWNER}&resource=${BACKEND}` +
  `&limit=100&direction=backward&startTime=${start}&endTime=${end}`;

const res = await fetch(url, {
  headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
});
const payload = await res.json();
const entries = Array.isArray(payload) ? payload : payload.logs ?? payload.data ?? [];
const lines = entries.map((e) => String(e.message ?? e.text ?? e.msg ?? ""));
const interesting = lines.filter(
  (m) =>
    /rnet_completion_trace|invoice-completion|00bb2a9|cmqw3n5hx|87d30575|OV255/i.test(m),
);

const out = {
  status: res.status,
  entryCount: entries.length,
  interestingCount: interesting.length,
  interesting: interesting.slice(0, 40).map((m) => m.slice(0, 400)),
  sample: lines.slice(0, 15).map((m) => m.slice(0, 200)),
};
writeFileSync(join(process.cwd(), "_tmp-rnet-logs-probe.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
