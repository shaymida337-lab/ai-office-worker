import express from "express";
import cors from "cors";
import path from "path";
import { config } from "./lib/config.js";
import { authRouter } from "./routes/auth.js";
import { apiRouter } from "./routes/api.js";
import { cronRouter } from "./routes/cron.js";
import { integrationsRouter } from "./routes/integrations.js";
import { webhooksRouter } from "./routes/webhooks.js";
import { clientsRouter } from "./routes/clients.js";
import { clientWhatsappRouter } from "./routes/clientWhatsapp.js";
import { socialRouter } from "./routes/social.js";
import { scheduler } from "./services/scheduler.js";

const app = express();

app.use(
  cors({
    origin(origin, callback) {
      const allowedOrigins = new Set([
        config.frontendUrl,
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        ...config.corsOrigins,
      ]);

      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`CORS blocked origin: ${origin}`));
    },
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/auth", authRouter);
app.use("/api/auth", authRouter);
app.use("/api/integrations", integrationsRouter);
app.use("/api/clients", clientWhatsappRouter);
app.use("/api/clients", clientsRouter);
app.use("/api/social", socialRouter);
app.use("/api", apiRouter);
app.use("/cron", cronRouter);
app.use("/webhook", webhooksRouter);
app.use("/webhooks", webhooksRouter);

const server = app.listen(config.port, () => {
  console.log(`Server running on port ${config.port}`);
  scheduler.startAllJobs();
});
server.on("error", (err: NodeJS.ErrnoException) => {
  console.error("[api] Failed to start:", err.message);
  process.exit(1);
});
