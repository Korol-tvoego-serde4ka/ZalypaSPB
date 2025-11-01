const { prisma } = require('../db/client');

async function logAudit(actorUserId, action, targetType = null, targetId = null, metadata = null) {
  if (!process.env.DATABASE_URL) return;
  try {
    await prisma.auditLog.create({ data: { actorUserId: actorUserId || null, action, targetType, targetId, metadata } });
  } catch (_) {}
}

module.exports = { logAudit };
