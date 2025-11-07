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
  const qtyRaw = (req.body && req.body.quantity) || 1;
  const pid = Number(productId);
  const quantity = Math.max(1, Math.min(100, Number(qtyRaw) || 1));
  if (!pid) return res.status(400).json({ error: 'invalid_payload' });
  try {
    if (!process.env.DATABASE_URL) return res.status(501).json({ error: 'not_supported' });
    const product = await prisma.product.findUnique({ where: { id: pid } });
    if (!product || !product.enabled) return res.status(404).json({ error: 'product_not_found' });
    const tokens = await prisma.$transaction(async (tx) => {
      const bal = await tx.resellerBalance.findUnique({ where: { resellerId: req.user.sub } });
      const price = product.priceCents;
      const balance = bal?.balanceCents || 0;
      const total = price * quantity;
      if (balance < total) throw new Error('insufficient_balance');
      const available = await tx.key.findMany({ where: { productId: pid, status: 'Available' }, orderBy: { id: 'asc' }, take: quantity });
      if (available.length < quantity) throw new Error('no_keys');
      const tokensLocal = [];
      for (const key of available) {
        await tx.key.update({ where: { id: key.id }, data: { status: 'Reserved', ownerResellerId: req.user.sub } });
        await tx.transaction.create({ data: { resellerId: req.user.sub, amountCents: -price, type: 'DEBIT', productId: pid, keyId: key.id } });
        tokensLocal.push(key.token);
      }
      await tx.resellerBalance.upsert({ where: { resellerId: req.user.sub }, update: { balanceCents: (balance - total) }, create: { resellerId: req.user.sub, balanceCents: (balance - total) } });
      return tokensLocal;
    });
    await logAudit(req.user.sub, `Bought ${tokens.length} key(s) for product ${pid}`, 'Product', pid, { quantity: tokens.length });
    if (tokens.length === 1) return res.json({ key: { token: tokens[0] }, keys: tokens.map(t => ({ token: t })) });
    return res.json({ keys: tokens.map(t => ({ token: t })) });
  } catch (e) {
    if (e.message === 'insufficient_balance') return res.status(402).json({ error: 'insufficient_balance' });
    if (e.message === 'no_keys') return res.status(404).json({ error: 'no_keys_available' });
    return res.status(500).json({ error: 'purchase_error' });
  }
});

// Purchase history for reseller
router.get('/purchases', async (req, res) => {
  try {
    if (!process.env.DATABASE_URL) return res.json({ items: [] });
    const txs = await prisma.transaction.findMany({
      where: { resellerId: req.user.sub, type: 'DEBIT' },
      include: { product: true, key: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const items = txs.map(t => ({
      id: t.id,
      createdAt: t.createdAt,
      amountCents: t.amountCents,
      product: t.product ? { id: t.product.id, name: t.product.name } : null,
      keyToken: t.key ? t.key.token : null,
    }));
    return res.json({ items });
  } catch (e) {
    return res.json({ items: [] });
  }
});

module.exports = router;
