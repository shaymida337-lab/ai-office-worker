import express from "express";
import cors from "cors";
import path from "path";
import { config } from "./lib/config.js";
import { connectPrisma, databaseHost, isPrismaConnected, prisma } from "./lib/prisma.js";

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

async function healthHandler(_req: express.Request, res: express.Response) {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", database: "connected" });
  } catch (err) {
    res.status(503).json({
      status: "error",
      database: "disconnected",
      host: databaseHost(),
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

app.get("/health", healthHandler);
app.get("/api/health", healthHandler);

app.use((req, res, next) => {
  if (isPrismaConnected()) {
    next();
    return;
  }

  console.error(`[api] Request blocked before Prisma connection path=${req.path} db=${databaseHost()}`);
  res.status(503).json({ error: "Database is not connected" });
});

async function registerRoutes() {
  const [
    { authRouter },
    { apiRouter },
    { cronRouter },
    { integrationsRouter },
    { webhooksRouter },
    { clientsRouter },
    { clientWhatsappRouter },
    { socialRouter },
  ] = await Promise.all([
    import("./routes/auth.js"),
    import("./routes/api.js"),
    import("./routes/cron.js"),
    import("./routes/integrations.js"),
    import("./routes/webhooks.js"),
    import("./routes/clients.js"),
    import("./routes/clientWhatsapp.js"),
    import("./routes/social.js"),
  ]);

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
}

async function start() {
  try {
    await connectPrisma();
  } catch (err) {
    console.error(`[api] Failed to connect database before startup db=${databaseHost()}`, err);
    process.exit(1);
  }

  await registerRoutes();
  const { scheduler } = await import("./services/scheduler.js");

  const server = app.listen(config.port, () => {
    console.log(`Server running on port ${config.port}`);
    scheduler.startAllJobs();
  });
  server.on("error", (err: NodeJS.ErrnoException) => {
    console.error("[api] Failed to start:", err.message);
    process.exit(1);
  });
}

void start();
