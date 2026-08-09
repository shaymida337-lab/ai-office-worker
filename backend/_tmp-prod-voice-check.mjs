import { config as loadEnv } from "dotenv";
import { existsSync } from "fs";
import { join } from "path";
import jwt from "jsonwebtoken";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const renderKey = process.env.RENDER_API_KEY?.trim();
const serviceId = "srv-d898po77f7vs73bu01v0";
const headers = { Authorization: `Bearer ${renderKey}`, Accept: "application/json" };
const envResponse = await fetch(
  `https://api.render.com/v1/services/${serviceId}/env-vars?limit=100`,
  { headers }
);
const rows = await envResponse.json();
const env = new Map(
  rows.map((row) => {
    const item = row.envVar ?? row;
    return [item.key, item.value];
  })
);

const token = jwt.sign(
  {
    userId: "cmpjd7j7e0000bl5tu149spmk",
    organizationId: "cmpjd7j7e0001bl5tzv049rxb",
    email: "shaymida337@gmail.com",
  },
  env.get("JWT_SECRET"),
  { expiresIn: "10m" }
);

const startedAt = new Date().toISOString();
const response = await fetch(
  "https://ai-office-worker-backend.onrender.com/api/natalie/voice",
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
    },
    body: JSON.stringify({ text: "שלום, זו בדיקת הקול של נטלי." }),
  }
);
const body = Buffer.from(await response.arrayBuffer());
const contentType = response.headers.get("content-type");
const bodyPreview = contentType?.includes("json")
  ? body.toString("utf8").slice(0, 500)
  : null;

const azureEastUsResponse = await fetch(
  "https://eastus.api.cognitive.microsoft.com/sts/v1.0/issueToken",
  {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": env.get("AZURE_SPEECH_KEY"),
      "Content-Length": "0",
    },
  }
);

console.log(
  JSON.stringify(
    {
      startedAt,
      finishedAt: new Date().toISOString(),
      status: response.status,
      contentType,
      audioBytes: contentType?.startsWith("audio/") ? body.length : 0,
      responseBytes: body.length,
      bodyPreview,
      resolvedProvider: env.get("AI_VOICE_PROVIDER") || "azure (auto because key is set)",
      resolvedVoice: env.get("AZURE_SPEECH_VOICE") || "he-IL-HilaNeural (code default)",
      regionIsEastus: env.get("AZURE_SPEECH_REGION") === "eastus",
      regionLength: String(env.get("AZURE_SPEECH_REGION") ?? "").length,
      azureKeyAtEastUsStatus: azureEastUsResponse.status,
      azureKeyAtEastUsValid: azureEastUsResponse.ok,
    },
    null,
    2
  )
);
