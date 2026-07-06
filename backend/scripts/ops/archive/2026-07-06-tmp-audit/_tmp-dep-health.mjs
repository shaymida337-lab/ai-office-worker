import { existsSync } from "node:fs";
import { join } from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: true });
}

process.env.DATABASE_URL = process.env.PROD_DATABASE_URL;
const org = "cmqxujfuj034ndy2czu9tjoko";
const { getSystemHealth } = await import("../src/services/systemHealth.js");
const health = await getSystemHealth(org);
console.log(JSON.stringify(health, null, 2));
