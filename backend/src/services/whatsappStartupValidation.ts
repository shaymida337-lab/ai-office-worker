import { checkTwilioConnection, getWhatsAppConfigurationStatus } from "./whatsapp.js";

export async function validateWhatsAppAtStartup() {
  const configuration = getWhatsAppConfigurationStatus();
  console.log(
    `[startup/whatsapp] provider=${configuration.provider} webhookUrl=${configuration.webhookUrl} from=${configuration.from || "none"}`
  );
  console.log(`[startup/whatsapp] envDiagnostics=${JSON.stringify(configuration.envDiagnostics)}`);
  console.log(`[startup/whatsapp] webhook candidates=${configuration.webhookUrls.join(",")}`);

  if (!configuration.configured) {
    console.error(`[startup/whatsapp] FAIL WhatsApp configuration missing: ${configuration.missingVariables.join(", ")}`);
    return;
  }

  const connection = await checkTwilioConnection();
  if (!connection.connected) {
    console.error(`[startup/whatsapp] FAIL Twilio account check failed: ${connection.reason ?? "unknown"}`);
    return;
  }

  console.log(
    `[startup/whatsapp] PASS provider=${configuration.provider} accountSid=${connection.account?.sid ?? "unknown"} accountStatus=${connection.account?.status ?? "unknown"}`
  );
}
