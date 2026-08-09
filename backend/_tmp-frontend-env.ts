import { config as loadEnv } from "dotenv";
import { existsSync } from "fs";
import { join } from "path";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: true });
}

async function main() {
  const SERVICE_ID = "srv-d8992s6gvqtc73boqfp0"; // frontend
  const apiKey = process.env.RENDER_API_KEY?.trim();
  if (!apiKey) throw new Error("RENDER_API_KEY missing");

  const keysWanted = new Set(["NEXT_PUBLIC_API_URL", "NEXT_PUBLIC_SITE_URL"]);
  const found = new Map<string, string>();
  let cursor: string | null = null;

  do {
    const qs = new URLSearchParams({ limit: "100" });
    if (cursor) qs.set("cursor", cursor);
    const res = await fetch(
      `https://api.render.com/v1/services/${SERVICE_ID}/env-vars?${qs}`,
      { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } }
    );
    if (!res.ok) throw new Error(`Render API ${res.status}`);
    const data = (await res.json()) as Array<{
      envVar?: { key: string; value: string };
      cursor?: string;
      key?: string;
      value?: string;
    }>;
    for (const item of data) {
      const ev = item.envVar ?? item;
      if (ev?.key && keysWanted.has(ev.key)) found.set(ev.key, ev.value ?? "");
    }
    cursor = data.at(-1)?.cursor ?? null;
  } while (cursor);

  console.log(JSON.stringify(Object.fromEntries(found), null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
