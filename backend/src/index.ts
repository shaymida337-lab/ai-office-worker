import express from "express";
import cors from "cors";
import path from "path";

type ConfigModule = typeof import("./lib/config.js");
type PrismaModule = typeof import("./lib/prisma.js");

process.on("unhandledRejection", (reason) => {
  console.error("[startup] Unhandled promise rejection", formatStartupError(reason));
});

process.on("uncaughtException", (err) => {
  console.error("[startup] Uncaught exception", formatStartupError(err));
  process.exit(1);
});

function formatStartupError(err: unknown) {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
  }
  return { message: String(err) };
}

function createApp(configModule: ConfigModule, prismaModule: PrismaModule) {
  const { config } = configModule;
  const { databaseHost, isPrismaConnected, prisma } = prismaModule;
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

  return app;
}

async function registerRoutes(app: express.Express) {
  try {
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
    app.use("/api/webhook", webhooksRouter);
    app.use("/api/webhooks", webhooksRouter);
    app.use("/api", apiRouter);
    app.use("/cron", cronRouter);
    app.use("/webhook", webhooksRouter);
    app.use("/webhooks", webhooksRouter);
  } catch (err) {
    console.error("[startup] Failed to register routes", formatStartupError(err));
    throw err;
  }
}

async function start() {
  let configModule: ConfigModule;
  let prismaModule: PrismaModule;
  try {
    configModule = await import("./lib/config.js");
    configModule.validateStartupEnv();
    prismaModule = await import("./lib/prisma.js");
  } catch (err) {
    console.error("[startup] Failed to load configuration or Prisma", formatStartupError(err));
    process.exit(1);
  }

  const { config } = configModule;
  const { connectPrisma, databaseHost } = prismaModule;
  const app = createApp(configModule, prismaModule);

  try {
    await connectPrisma();
    await registerRoutes(app);
    const { scheduler } = await import("./services/scheduler.js");

    const server = app.listen(config.port, () => {
      console.log(`[startup] Server running port=${config.port} env=${config.nodeEnv} db=${databaseHost()}`);
      try {
        scheduler.startAllJobs();
      } catch (err) {
        console.error("[startup] Scheduler failed to start", formatStartupError(err));
      }
    });
    server.on("error", (err: NodeJS.ErrnoException) => {
      console.error("[startup] HTTP server failed to start", formatStartupError(err));
      process.exit(1);
    });
  } catch (err) {
    console.error(`[startup] Backend startup failed db=${databaseHost()}`, formatStartupError(err));
    process.exit(1);
  }
}

void start();
