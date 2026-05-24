const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const { logger } = require('../utils/logger');

const prisma = new PrismaClient();

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        accessToken: true,
        refreshToken: true,
        driveFolder: true,
        driveFolderUrl: true,
        driveFolderId: true,
        sheetsId: true,
        invoiceSheetUrl: true,
        invoiceSheetId: true,
        taskSheetUrl: true,
        taskSheetId: true,
        isActive: true,
      },
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'User not found or inactive' });
    }

    req.user = user;
    next();
  } catch (err) {
    logger.warn('Auth failed', { error: err.message });
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

module.exports = { authenticate };
