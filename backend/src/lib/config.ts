import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function optional(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

function requiredInProduction(name: string, fallback: string): string {
  const value = process.env[name];
  if (value) return value;
  if (process.env.NODE_ENV === "production") {
    throw new Error(`Missing env: ${name}`);
  }
  return fallback;
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

  return "http://localhost:4000/api/integrations/gmail/callback";
}

export const config = {
  port: parseInt(optional("PORT", "4000"), 10),
  nodeEnv: optional("NODE_ENV", "development"),
  databaseUrl: optional("DATABASE_URL", "file:./dev.db"),
  jwtSecret: requiredInProduction("JWT_SECRET", "dev-secret-change-in-production"),
  frontendUrl: optional("FRONTEND_URL", "http://localhost:3000"),
  corsOrigins: optional("CORS_ORIGINS")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  cronSecret: optional("CRON_SECRET", process.env.NODE_ENV === "production" ? "" : "dev-cron-secret"),

  google: {
    clientId: optional("GOOGLE_CLIENT_ID"),
    clientSecret: optional("GOOGLE_CLIENT_SECRET"),
    redirectUri: optional(
      "GOOGLE_REDIRECT_URI",
      optional("GOOGLE_CALLBACK_URL", "http://localhost:4000/auth/google/callback")
    ),
    integrationRedirectUri: optional(
      "GOOGLE_INTEGRATION_REDIRECT_URI",
      defaultGmailIntegrationRedirectUri()
    ).replace(/\/(?:api\/)?auth\/google\/callback$/, "/api/integrations/gmail/callback"),
    clientGmailRedirectUri: optional(
      "GOOGLE_CLIENT_REDIRECT_URI",
      "http://localhost:4000/api/clients/gmail/callback"
    ),
  },

  anthropic: {
    apiKey: optional("ANTHROPIC_API_KEY"),
    model: optional("ANTHROPIC_MODEL", "claude-haiku-4-5-20251001"),
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
      "http://localhost:4000/webhook/whatsapp"
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

export function hasGoogleOAuth(): boolean {
  return Boolean(config.google.clientId && config.google.clientSecret);
}

export function hasClaude(): boolean {
  return Boolean(config.anthropic.apiKey);
}

export function hasTwilio(): boolean {
  return Boolean(
    config.twilio.accountSid &&
      config.twilio.authToken &&
      config.twilio.whatsappFrom
  );
}
