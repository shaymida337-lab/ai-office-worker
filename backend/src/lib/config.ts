import "dotenv/config";

function optional(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

function requiredInProduction(name: string, fallback: string): string {
  const value = process.env[name];
  if (value) return value;
  return fallback;
}

function rejectLocalhostInProduction(_name: string, value: string): string {
  return value;
}

function configured(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

export function missingTwilioEnvVars(): string[] {
  const missing: string[] = [];
  if (!configured("TWILIO_ACCOUNT_SID")) missing.push("TWILIO_ACCOUNT_SID");
  if (!configured("TWILIO_AUTH_TOKEN")) missing.push("TWILIO_AUTH_TOKEN");
  if (!configured("TWILIO_WHATSAPP_NUMBER") && !configured("TWILIO_WHATSAPP_FROM")) {
    missing.push("TWILIO_WHATSAPP_NUMBER");
  }
  return missing;
}

function toGmailIntegrationRedirectUri(uri: string): string {
  return uri.replace(/\/(?:api\/)?auth\/google\/callback$/, "/api/integrations/gmail/callback");
}

function defaultGmailIntegrationRedirectUri(): string {
  const explicit = process.env.GOOGLE_INTEGRATION_REDIRECT_URI;
  if (explicit) return toGmailIntegrationRedirectUri(explicit);

  const loginRedirect = process.env.GOOGLE_REDIRECT_URI ?? process.env.GOOGLE_CALLBACK_URL;
  if (loginRedirect) {
    return toGmailIntegrationRedirectUri(loginRedirect);
  }

  return `${defaultBackendUrl()}/api/integrations/gmail/callback`;
}

function defaultBackendUrl(): string {
  return process.env.NODE_ENV === "production"
    ? "https://ai-office-worker-backend.onrender.com"
    : "http://localhost:4000";
}

function defaultFrontendUrl(): string {
  return process.env.NODE_ENV === "production"
    ? "https://ai-office-worker-frontend.onrender.com"
    : "http://localhost:3000";
}

export const config = {
  port: parseInt(optional("PORT", "4000"), 10),
  nodeEnv: optional("NODE_ENV", "development"),
  databaseUrl: optional("DATABASE_URL", "file:./dev.db"),
  jwtSecret: requiredInProduction("JWT_SECRET", "dev-secret-change-in-production"),
  frontendUrl: optional("FRONTEND_URL", defaultFrontendUrl()),
  corsOrigins: optional("CORS_ORIGINS")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  cronSecret: optional("CRON_SECRET", process.env.NODE_ENV === "production" ? "" : "dev-cron-secret"),

  google: {
    clientId: optional("GOOGLE_CLIENT_ID"),
    clientSecret: optional("GOOGLE_CLIENT_SECRET"),
    redirectUri: rejectLocalhostInProduction(
      "GOOGLE_REDIRECT_URI",
      optional("GOOGLE_REDIRECT_URI", optional("GOOGLE_CALLBACK_URL", `${defaultBackendUrl()}/auth/google/callback`))
    ),
    integrationRedirectUri: rejectLocalhostInProduction(
      "GOOGLE_INTEGRATION_REDIRECT_URI",
      optional("GOOGLE_INTEGRATION_REDIRECT_URI", defaultGmailIntegrationRedirectUri())
    ).replace(/\/(?:api\/)?auth\/google\/callback$/, "/api/integrations/gmail/callback"),
    clientGmailRedirectUri: rejectLocalhostInProduction(
      "GOOGLE_CLIENT_REDIRECT_URI",
      optional("GOOGLE_CLIENT_REDIRECT_URI", `${defaultBackendUrl()}/api/clients/gmail/callback`)
    ),
  },

  anthropic: {
    apiKey: optional("ANTHROPIC_API_KEY"),
    model: optional("ANTHROPIC_MODEL", "claude-haiku-4-5-20251001"),
  },

  aiVoice: {
    provider: optional("AI_VOICE_PROVIDER", optional("OPENAI_API_KEY") ? "openai" : "browser"),
    openAiApiKey: optional("OPENAI_API_KEY"),
    openAiModel: optional("OPENAI_TTS_MODEL", "gpt-4o-mini-tts"),
    openAiVoice: optional("OPENAI_TTS_VOICE", "nova"),
  },

  twilio: {
    accountSid: optional("TWILIO_ACCOUNT_SID"),
    authToken: optional("TWILIO_AUTH_TOKEN"),
    whatsappFrom: optional(
      "TWILIO_WHATSAPP_NUMBER",
      optional("TWILIO_WHATSAPP_FROM", "whatsapp:+14155238886")
    ),
    ownerWhatsApp: optional("OWNER_WHATSAPP", optional("OWNER_WHATSAPP_NUMBER")),
    webhookUrl: optional(
      "TWILIO_WEBHOOK_URL",
      `${defaultBackendUrl()}/webhook/whatsapp`
    ),
  },

  canva: {
    clientId: optional("CANVA_CLIENT_ID"),
    clientSecret: optional("CANVA_CLIENT_SECRET"),
  },

  facebook: {
    appId: optional("FACEBOOK_APP_ID"),
    appSecret: optional("FACEBOOK_APP_SECRET"),
  },

  linkedin: {
    clientId: optional("LINKEDIN_CLIENT_ID"),
    clientSecret: optional("LINKEDIN_CLIENT_SECRET"),
  },

  driveRootFolder: optional("GOOGLE_DRIVE_ROOT", "AI Office Worker"),
};

export function validateStartupEnv() {
  const missing: string[] = [];
  if (config.nodeEnv === "production") {
    for (const name of ["DATABASE_URL", "JWT_SECRET"]) {
      if (!configured(name)) missing.push(name);
    }
  }

  if (missing.length) {
    throw new Error(
      [
        `Missing required production environment variables: ${missing.join(", ")}`,
        "Set them on the Render backend service before deploying.",
      ].join("\n")
    );
  }

  if (!Number.isFinite(config.port)) {
    throw new Error(`Invalid PORT value: ${process.env.PORT ?? "(missing)"}`);
  }

  if (config.nodeEnv === "production") {
    const localhostValues = [
      ["FRONTEND_URL", config.frontendUrl],
      ["GOOGLE_REDIRECT_URI", config.google.redirectUri],
      ["GOOGLE_INTEGRATION_REDIRECT_URI", config.google.integrationRedirectUri],
      ["GOOGLE_CLIENT_REDIRECT_URI", config.google.clientGmailRedirectUri],
      ["TWILIO_WEBHOOK_URL", config.twilio.webhookUrl],
    ].filter(([, value]) => /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::|\/|$)/i.test(String(value)));
    if (localhostValues.length) {
      throw new Error(
        [
          "Production environment contains localhost URLs:",
          ...localhostValues.map(([name, value]) => `- ${name}=${value}`),
          "Set production URLs on the Render backend service.",
        ].join("\n")
      );
    }
  }

  const optionalWarnings: string[] = [];
  const googleKeys = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"];
  const configuredGoogle = googleKeys.filter(configured);
  if (configuredGoogle.length > 0 && configuredGoogle.length < googleKeys.length) {
    optionalWarnings.push(`Google OAuth is partially configured. Missing: ${googleKeys.filter((name) => !configured(name)).join(", ")}`);
  }

  const missingTwilio = missingTwilioEnvVars();
  const anyTwilioConfigured = [
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_WHATSAPP_NUMBER",
    "TWILIO_WHATSAPP_FROM",
    "TWILIO_WEBHOOK_URL",
  ].some(configured);
  if (anyTwilioConfigured && missingTwilio.length) {
    optionalWarnings.push(`WhatsApp configuration missing: ${missingTwilio.join(", ")}`);
  }

  for (const warning of optionalWarnings) {
    console.warn(`[startup] ${warning}`);
  }
}

export function hasGoogleOAuth(): boolean {
  return Boolean(config.google.clientId && config.google.clientSecret);
}

export function hasClaude(): boolean {
  return Boolean(config.anthropic.apiKey);
}

export function hasTwilio(): boolean {
  return missingTwilioEnvVars().length === 0;
}
