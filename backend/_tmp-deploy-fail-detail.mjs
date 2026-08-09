import { config as loadEnv } from "dotenv";
import { existsSync } from "fs";
import { join } from "path";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const apiKey = process.env.RENDER_API_KEY?.trim();
if (!apiKey) {
  console.error("RENDER_API_KEY missing");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${apiKey}`,
  Accept: "application/json",
};

const deployId = process.argv[2] || "dep-d9dlkkkvikkc73b93f60";
const serviceId = "srv-d8992s6gvqtc73boqfp0";

const res = await fetch(`https://api.render.com/v1/services/${serviceId}/deploys/${deployId}`, { headers });
const body = await res.json();
console.log(JSON.stringify(body, null, 2));
