const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { prisma } = require('../db/client');

router.get('/latest', requireAuth, async (_req, res) => {
  try {
    const release = await prisma.loaderRelease.findFirst({ orderBy: { createdAt: 'desc' } });
    if (!release) return res.status(404).json({ error: 'no_release' });
    return res.json({ version: release.version, url: release.filePath, checksum: release.checksum || null });
  } catch (e) {
    return res.status(500).json({ error: 'loader_error' });
  }
});

module.exports = router;
