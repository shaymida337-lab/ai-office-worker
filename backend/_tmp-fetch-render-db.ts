import { config as loadEnv } from "dotenv";
import { existsSync, writeFileSync } from "fs";
import { join } from "path";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: true });
}

async function main() {
  const SERVICE_ID = process.env.RENDER_SERVICE_ID ?? "srv-d898po77f7vs73bu01v0";
  const apiKey = process.env.RENDER_API_KEY?.trim();
  if (!apiKey) throw new Error("RENDER_API_KEY missing");

  const keysWanted = new Set(["DATABASE_URL", "PROD_DATABASE_URL", "FRONTEND_URL", "NODE_ENV"]);
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

  function hostOf(raw?: string) {
    if (!raw) return null;
    try {
      return new URL(raw).host;
    } catch {
      return "invalid";
    }
  }

  console.log(
    JSON.stringify(
      {
        serviceId: SERVICE_ID,
        keysFound: [...found.keys()],
        DATABASE_URL_host: hostOf(found.get("DATABASE_URL")),
        PROD_DATABASE_URL_host: hostOf(found.get("PROD_DATABASE_URL")),
        FRONTEND_URL: found.get("FRONTEND_URL") ?? null,
        NODE_ENV: found.get("NODE_ENV") ?? null,
      },
      null,
      2
    )
  );

  if (found.get("DATABASE_URL")) {
    writeFileSync(join(process.cwd(), ".env.render-db.tmp"), `DATABASE_URL=${found.get("DATABASE_URL")}\n`, "utf8");
    console.log("wrote .env.render-db.tmp");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
