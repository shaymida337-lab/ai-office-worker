const cron = require('node-cron');
const { PrismaClient } = require('@prisma/client');
const { processUserEmails } = require('../services/emailProcessor');
const { sendDailySummary, sendEveningSummary } = require('../services/emailSummary');
const { logger } = require('../utils/logger');

const prisma = new PrismaClient();

/**
 * Start all cron jobs.
 */
const startScheduler = () => {
  // Every 2 hours: scan for new emails
  cron.schedule('0 */2 * * *', async () => {
    logger.info('⏰ Email scan job started');
    await runEmailScan();
  });

  // Every day at 08:00 (Israel time): send daily summary
  cron.schedule('0 8 * * *', async () => {
    logger.info('⏰ Daily summary job started');
    await runDailySummary();
  }, {
    timezone: 'Asia/Jerusalem',
  });

  // Every day at 18:00 (Israel time): send evening WhatsApp summary
  cron.schedule('0 18 * * *', async () => {
    logger.info('⏰ Evening summary job started');
    await runEveningSummary();
  }, {
    timezone: 'Asia/Jerusalem',
  });

  logger.info('✅ Scheduler started: scan every 2h, summary at 08:00 IL');
};

const runEmailScan = async () => {
  try {
    const users = await prisma.user.findMany({
      where: { isActive: true, accessToken: { not: null } },
    });

    logger.info(`Scanning emails for ${users.length} users`);

    for (const user of users) {
      try {
        const stats = await processUserEmails(user);
        logger.info('User scan complete', { userId: user.id, stats });
      } catch (err) {
        logger.error('User scan failed', { userId: user.id, error: err.message });
      }
    }
  } catch (err) {
    logger.error('runEmailScan failed', { error: err.message });
  }
};

const runDailySummary = async () => {
  try {
    const users = await prisma.user.findMany({
      where: { isActive: true, accessToken: { not: null } },
    });

    for (const user of users) {
      try {
        await sendDailySummary(user);
      } catch (err) {
        logger.error('Daily summary failed', { userId: user.id, error: err.message });
      }
    }
  } catch (err) {
    logger.error('runDailySummary failed', { error: err.message });
  }
};

const runEveningSummary = async () => {
  try {
    const users = await prisma.user.findMany({ where: { isActive: true } });
    for (const user of users) {
      try {
        await sendEveningSummary(user);
      } catch (err) {
        logger.error('Evening summary failed', { userId: user.id, error: err.message });
      }
    }
  } catch (err) {
    logger.error('runEveningSummary failed', { error: err.message });
  }
};

module.exports = { startScheduler, runEmailScan, runDailySummary, runEveningSummary };
