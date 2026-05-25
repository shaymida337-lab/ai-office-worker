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

export const config = {
  port: parseInt(optional("PORT", "4000"), 10),
  nodeEnv: optional("NODE_ENV", "development"),
  databaseUrl: optional("DATABASE_URL", "file:./dev.db"),
  jwtSecret: requiredInProduction("JWT_SECRET", "dev-secret-change-in-production"),
  frontendUrl: optional("FRONTEND_URL", "http://localhost:3000"),
  cronSecret: requiredInProduction("CRON_SECRET", "dev-cron-secret"),

  google: {
    clientId: optional("GOOGLE_CLIENT_ID"),
    clientSecret: optional("GOOGLE_CLIENT_SECRET"),
    redirectUri: optional(
      "GOOGLE_REDIRECT_URI",
      optional(
        "GOOGLE_CALLBACK_URL",
        "https://ai-office-worker-backend.onrender.com/api/auth/google/callback"
      )
    ),
    integrationRedirectUri: optional(
      "GOOGLE_INTEGRATION_REDIRECT_URI",
      optional(
        "GOOGLE_CALLBACK_URL",
        "https://ai-office-worker-backend.onrender.com/api/auth/google/callback"
      )
    ),
    clientGmailRedirectUri: optional(
      "GOOGLE_CLIENT_REDIRECT_URI",
      "https://ai-office-worker-backend.onrender.com/api/clients/gmail/callback"
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
      "https://ai-office-worker-backend.onrender.com/webhook/whatsapp"
    ),
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
