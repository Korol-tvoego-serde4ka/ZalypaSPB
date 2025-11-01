const express = require('express');
const router = express.Router();
const { requireAuth, requireRoles } = require('../middleware/auth');
const { prisma } = require('../db/client');
const { logAudit } = require('../utils/audit');

router.post('/activate', requireAuth, requireRoles('User', 'Admin'), async (req, res) => {
  const { key: token, product_id } = req.body || {};
  if (!token) return res.status(400).json({ error: 'invalid_key' });
  try {
    const dbKey = await prisma.key.findUnique({ where: { token } });
    if (!dbKey) return res.status(404).json({ error: 'key_not_found' });
    if (dbKey.status === 'Used') return res.status(409).json({ error: 'key_used' });
    if (product_id && dbKey.productId !== Number(product_id)) return res.status(400).json({ error: 'product_mismatch' });

    const product = await prisma.product.findUnique({ where: { id: dbKey.productId } });
    if (!product || !product.enabled) return res.status(400).json({ error: 'product_disabled' });
    const durationDays = product.defaultDurationDays || 30;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + durationDays * 24 * 3600 * 1000);

    await prisma.$transaction([
      prisma.key.update({ where: { id: dbKey.id }, data: { status: 'Used', usedByUserId: req.user.sub, usedAt: now } }),
      prisma.subscription.upsert({ where: { userId_productId: { userId: req.user.sub, productId: dbKey.productId } }, update: { expiresAt }, create: { userId: req.user.sub, productId: dbKey.productId, expiresAt } }),
    ]);

    await logAudit(req.user.sub, `Activated key ${token}`, 'Key', dbKey.id, { productId: dbKey.productId });
    return res.json({ success: true, subscription: { product_id: dbKey.productId, expires_at: expiresAt.toISOString() } });
  } catch (e) {
    return res.status(500).json({ error: 'activation_error' });
  }
});

module.exports = router;
