import { config as loadEnv } from "dotenv";
import { existsSync } from "fs";
import { join } from "path";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: true });
}

async function main() {
  const apiKey = process.env.RENDER_API_KEY?.trim();
  if (!apiKey) throw new Error("RENDER_API_KEY missing");

  const res = await fetch("https://api.render.com/v1/services?limit=50", {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Render API ${res.status}`);
  const data = (await res.json()) as Array<{
    service?: { id: string; name: string; type: string; serviceDetails?: { url?: string } };
    cursor?: string;
  }>;

  const services = data.map((item) => ({
    id: item.service?.id,
    name: item.service?.name,
    type: item.service?.type,
    url: item.service?.serviceDetails?.url,
  }));
  console.log(JSON.stringify(services, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
