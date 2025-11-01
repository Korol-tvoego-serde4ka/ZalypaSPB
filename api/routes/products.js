const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { prisma } = require('../db/client');

router.get('/', requireAuth, async (_req, res) => {
  try {
    const items = await prisma.product.findMany({ where: { enabled: true }, orderBy: { id: 'asc' } });
    return res.json({ items });
  } catch (_) {
    return res.json({ items: [] });
  }
});

module.exports = router;
