const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { prisma } = require('../db/client');

// Ensure user has linked Telegram before accessing loader
async function ensureTelegramLinked(req, res, next) {
  try {
    const u = await prisma.user.findUnique({ where: { id: req.user.sub } });
    if (!u || !u.telegramId) return res.status(403).json({ error: 'telegram_required' });
    return next();
  } catch (_) {
    return res.status(500).json({ error: 'server_error' });
  }
}

router.get('/latest', requireAuth, ensureTelegramLinked, async (_req, res) => {
  try {
    const release = await prisma.loaderRelease.findFirst({ orderBy: { createdAt: 'desc' } });
    if (!release) return res.status(404).json({ error: 'no_release' });
    return res.json({ version: release.version, url: release.filePath, checksum: release.checksum || null });
  } catch (e) {
    return res.status(500).json({ error: 'loader_error' });
  }
});

module.exports = router;
