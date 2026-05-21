const logger = require('../utils/logger').logger;
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromNumber = process.env.TWILIO_WHATSAPP_FROM; // e.g. 'whatsapp:+1415...'

let client = null;
try {
  if (accountSid && authToken) {
    const Twilio = require('twilio');
    client = new Twilio(accountSid, authToken);
  }
} catch (err) {
  logger.warn('Twilio client init failed', { error: err.message });
}

const sendWhatsApp = async (toNumber, message) => {
  if (!client) {
    logger.warn('Twilio client not configured. Skipping WhatsApp message.');
    return false;
  }
  if (!fromNumber) {
    logger.warn('TWILIO_WHATSAPP_FROM not set; skipping WhatsApp message.');
    return false;
  }

  try {
    await client.messages.create({
      from: fromNumber,
      to: `whatsapp:${toNumber}`,
      body: message,
    });
    logger.info('WhatsApp sent', { to: toNumber });
    return true;
  } catch (err) {
    logger.error('Failed to send WhatsApp', { error: err.message });
    return false;
  }
};

module.exports = { sendWhatsApp };
