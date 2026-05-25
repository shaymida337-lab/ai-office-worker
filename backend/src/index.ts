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
import { scheduler } from "./services/scheduler.js";

const app = express();

app.use(
  cors({
    origin(origin, callback) {
      const allowedOrigins = new Set([
        config.frontendUrl,
        "https://ai-office-worker-frontend.onrender.com",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
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
  res.json({ status: "ok", service: "ai-office-worker-api" });
});

app.use("/auth", authRouter);
app.use("/api/auth", authRouter);
app.use("/api/integrations", integrationsRouter);
app.use("/api/clients", clientsRouter);
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

if (process.env.NODE_ENV === "production") {
  setInterval(() => {
    fetch("https://ai-office-worker-backend.onrender.com/health").catch(() => {
      // Keep-alive failures should never crash the API process.
    });
  }, 14 * 60 * 1000);
}
