import express from "express";
import cors from "cors";
import path from "path";

type ConfigModule = typeof import("./lib/config.js");
type PrismaModule = typeof import("./lib/prisma.js");
type BuildInfoModule = typeof import("./lib/buildInfo.js");

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

function createApp(configModule: ConfigModule, prismaModule: PrismaModule, buildInfoModule: BuildInfoModule) {
  const { config } = configModule;
  const { databaseHost, isPrismaConnected, prisma } = prismaModule;
  const { getHealthPayload } = buildInfoModule;
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
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        const url = (req as { originalUrl?: string; url?: string }).originalUrl ?? req.url ?? "";
        if (url.includes("/webhook/stripe") || url.includes("/webhooks/stripe")) {
          (req as express.Request & { rawBody?: string }).rawBody = buf.toString("utf8");
        }
      },
    })
  );
  app.use(express.urlencoded({ extended: true }));
  app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

  async function healthHandler(_req: express.Request, res: express.Response) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json(getHealthPayload({ status: "ok", database: "connected" }));
    } catch (err) {
      res.status(503).json({
        ...getHealthPayload({ status: "error", database: "disconnected" }),
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
      { billingRouter },
      { cronRouter },
      { integrationsRouter },
      { webhooksRouter },
      { clientsRouter },
      { clientWhatsappRouter },
      { socialRouter },
    ] = await Promise.all([
      import("./routes/auth.js"),
      import("./routes/api.js"),
      import("./routes/billing.js"),
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
    app.use("/api/billing", billingRouter);
    app.use("/api/clients", clientsRouter);
    app.use("/api/clients", clientWhatsappRouter);
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
  let buildInfoModule: BuildInfoModule;
  try {
    configModule = await import("./lib/config.js");
    configModule.validateStartupEnv();
    prismaModule = await import("./lib/prisma.js");
    buildInfoModule = await import("./lib/buildInfo.js");
  } catch (err) {
    console.error("[startup] Failed to load configuration or Prisma", formatStartupError(err));
    process.exit(1);
  }

  const { config } = configModule;
  const { connectPrisma, databaseHost } = prismaModule;
  const app = createApp(configModule, prismaModule, buildInfoModule);

  try {
    await connectPrisma();
    await registerRoutes(app);

    app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      console.error("[express] Unhandled route error", formatStartupError(err));
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    });

    const { scheduler } = await import("./services/scheduler.js");

    const server = app.listen(config.port, () => {
      console.log(`[startup] Server running port=${config.port} env=${config.nodeEnv} db=${databaseHost()}`);
      import("./services/googleStartupValidation.js")
        .then(({ validateGoogleIntegrationsAtStartup }) => validateGoogleIntegrationsAtStartup())
        .catch((err) => console.error("[startup/google] validation crashed", formatStartupError(err)));
      import("./services/whatsappStartupValidation.js")
        .then(({ validateWhatsAppAtStartup }) => validateWhatsAppAtStartup())
        .catch((err) => console.error("[startup/whatsapp] validation crashed", formatStartupError(err)));
      try {
        scheduler.startAllJobs();
      } catch (err) {
        console.error("[startup] Scheduler failed to start", formatStartupError(err));
      }
    });
    server.requestTimeout = 5 * 60 * 1000;
    server.headersTimeout = 5 * 60 * 1000 + 5000;
    server.keepAliveTimeout = 65 * 1000;
    console.log("[startup] HTTP timeouts configured requestTimeoutMs=300000 headersTimeoutMs=305000 keepAliveTimeoutMs=65000");
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
