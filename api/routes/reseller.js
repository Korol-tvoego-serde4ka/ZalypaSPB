const express = require('express');
const router = express.Router();
const { requireAuth, requireRoles } = require('../middleware/auth');
const { prisma } = require('../db/client');
const { logAudit } = require('../utils/audit');

router.use(requireAuth, requireRoles('Reseller', 'Admin'));

router.get('/users', async (req, res) => {
  try {
    const invites = await prisma.invite.findMany({ where: { createdById: req.user.sub, usedById: { not: null } }, include: { usedBy: true }, orderBy: { id: 'desc' } });
    const items = invites.map(i => ({ id: i.usedBy.id, username: i.usedBy.username, email: i.usedBy.email || null, status: i.usedBy.statusBlocked ? 'Заблокирован' : 'Активен' }));
    return res.json({ items });
  } catch (e) {
    return res.json({ items: [] });
  }
});

router.get('/products', async (req, res) => {
  try {
    const products = await prisma.product.findMany({ where: { enabled: true }, orderBy: { id: 'asc' } });
    const items = await Promise.all(products.map(async p => {
      const reserved = await prisma.key.count({ where: { productId: p.id, ownerResellerId: req.user.sub, status: 'Reserved' } });
      return { id: p.id, name: p.name, priceCents: p.priceCents, reservedCount: reserved };
    }));
    return res.json({ items });
  } catch (e) {
    return res.json({ items: [] });
  }
});

router.get('/balance', async (req, res) => {
  try {
    const bal = await prisma.resellerBalance.findUnique({ where: { resellerId: req.user.sub } });
    return res.json({ balance_cents: bal?.balanceCents || 0 });
  } catch (e) {
    return res.json({ balance_cents: 0 });
  }
});

router.post('/keys/buy', async (req, res) => {
  const { productId } = req.body || {};
  const pid = Number(productId);
  if (!pid) return res.status(400).json({ error: 'invalid_payload' });
  try {
    if (!process.env.DATABASE_URL) return res.status(501).json({ error: 'not_supported' });
    const product = await prisma.product.findUnique({ where: { id: pid } });
    if (!product || !product.enabled) return res.status(404).json({ error: 'product_not_found' });
    const result = await prisma.$transaction(async (tx) => {
      const bal = await tx.resellerBalance.findUnique({ where: { resellerId: req.user.sub } });
      const price = product.priceCents;
      const balance = bal?.balanceCents || 0;
      if (balance < price) throw new Error('insufficient_balance');
      const key = await tx.key.findFirst({ where: { productId: pid, status: 'Available' }, orderBy: { id: 'asc' } });
      if (!key) throw new Error('no_keys');
      await tx.key.update({ where: { id: key.id }, data: { status: 'Reserved', ownerResellerId: req.user.sub } });
      await tx.resellerBalance.upsert({ where: { resellerId: req.user.sub }, update: { balanceCents: balance - price }, create: { resellerId: req.user.sub, balanceCents: balance - price } });
      await tx.transaction.create({ data: { resellerId: req.user.sub, amountCents: -price, type: 'DEBIT', productId: pid, keyId: key.id } });
      return key;
    });
    await logAudit(req.user.sub, `Bought key for product ${pid}`, 'Key', result.id);
    return res.json({ key: { token: result.token } });
  } catch (e) {
    if (e.message === 'insufficient_balance') return res.status(402).json({ error: 'insufficient_balance' });
    if (e.message === 'no_keys') return res.status(404).json({ error: 'no_keys_available' });
    return res.status(500).json({ error: 'purchase_error' });
  }
});

module.exports = router;
