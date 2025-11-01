const express = require('express');
const router = express.Router();
const { requireAuth, requireRoles } = require('../middleware/auth');
const { prisma } = require('../db/client');
const crypto = require('crypto');
const { logAudit } = require('../utils/audit');
const bcrypt = require('bcryptjs');
const { banInGroup, unbanInGroup } = require('../services/telegram');

router.use(requireAuth, requireRoles('Admin'));

router.get('/users', async (_req, res) => {
  try {
    const items = await prisma.user.findMany({ orderBy: { id: 'asc' } });
    const mapped = items.map(u => ({ id: u.id, username: u.username, role: u.role, email: u.email || null, status: u.statusBlocked ? 'Заблокирован' : 'Активен' }));
    return res.json({ items: mapped });
  } catch (e) {
    return res.json({ items: [] });
  }
});

router.get('/logs', async (_req, res) => {
  try {
    const logs = await prisma.auditLog.findMany({ include: { actorUser: true }, orderBy: { createdAt: 'desc' }, take: 100 });
    const items = logs.map(l => ({ who: l.actorUser ? l.actorUser.username : 'system', what: l.action, when: l.createdAt.toISOString() }));
    return res.json({ items });
  } catch (e) {
    return res.json({ items: [] });
  }
});

router.get('/invites', async (_req, res) => {
  try {
    if (process.env.DATABASE_URL) {
      const items = await prisma.invite.findMany({ orderBy: { id: 'desc' }, take: 200 });
      return res.json({ items });
    }
  } catch (e) {}
  res.json({ items: [] });
});

router.post('/invites', async (req, res) => {
  const { count, codes, expiresDays } = req.body || {};
  const expiresAt = expiresDays ? new Date(Date.now() + Number(expiresDays) * 24 * 3600 * 1000) : null;
  try {
    if (!process.env.DATABASE_URL) return res.status(501).json({ error: 'not_supported' });
    const toCreate = [];
    if (Array.isArray(codes) && codes.length > 0) {
      for (const c of codes) toCreate.push({ code: String(c), expiresAt, createdById: req.user.sub });
    } else {
      const n = Math.min(Number(count) || 1, 1000);
      for (let i = 0; i < n; i++) {
        const code = crypto.randomBytes(12).toString('hex');
        toCreate.push({ code, expiresAt, createdById: req.user.sub });
      }
    }
    const created = [];
    for (const item of toCreate) {
      try {
        const r = await prisma.invite.create({ data: item });
        created.push(r);
      } catch (_) {}
    }
    await logAudit(req.user.sub, `Created invites: ${created.length}`);
    return res.json({ items: created });
  } catch (e) {
    return res.status(500).json({ error: 'create_error' });
  }
});

router.delete('/invites/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  try {
    if (!process.env.DATABASE_URL) return res.status(501).json({ error: 'not_supported' });
    const inv = await prisma.invite.findUnique({ where: { id } });
    if (!inv) return res.status(404).json({ error: 'not_found' });
    if (inv.usedById) return res.status(409).json({ error: 'already_used' });
    await prisma.invite.delete({ where: { id } });
    await logAudit(req.user.sub, `Deleted invite ${id}`, 'Invite', id);
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'delete_error' });
  }
});

router.post('/keys/upload', async (req, res) => {
  const { productId, keysText, ownerResellerId } = req.body || {};
  const pid = Number(productId);
  if (!pid || !keysText) return res.status(400).json({ error: 'invalid_payload' });
  try {
    if (!process.env.DATABASE_URL) return res.status(501).json({ error: 'not_supported' });
    const product = await prisma.product.findUnique({ where: { id: pid } });
    if (!product) return res.status(404).json({ error: 'product_not_found' });
    const tokens = String(keysText).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (tokens.length === 0) return res.status(400).json({ error: 'no_keys' });
    const data = tokens.map(t => ({ token: t, productId: pid, status: ownerResellerId ? 'Reserved' : 'Available', ownerResellerId: ownerResellerId ? Number(ownerResellerId) : null }));
    let debit = 0;
    const result = await prisma.$transaction(async (tx) => {
      if (ownerResellerId) {
        const rid = Number(ownerResellerId);
        const balance = await tx.resellerBalance.findUnique({ where: { resellerId: rid } });
        const price = product.priceCents;
        const created = await tx.key.createMany({ data, skipDuplicates: true });
        debit = created.count * price;
        const newBal = (balance?.balanceCents || 0) - debit;
        if (newBal < 0) throw new Error('insufficient_balance');
        await tx.resellerBalance.upsert({ where: { resellerId: rid }, update: { balanceCents: newBal }, create: { resellerId: rid, balanceCents: newBal } });
        await tx.transaction.create({ data: { resellerId: rid, amountCents: -debit, type: 'DEBIT', productId: pid } });
        return created.count;
      } else {
        const created = await tx.key.createMany({ data, skipDuplicates: true });
        return created.count;
      }
    });
    await logAudit(req.user.sub, `Uploaded ${result} keys for product ${pid}`, 'Product', pid, { debit });
    return res.json({ inserted: result, debit_cents: debit });
  } catch (e) {
    if (e.message === 'insufficient_balance') return res.status(402).json({ error: 'insufficient_balance' });
    return res.status(500).json({ error: 'upload_error' });
  }
});

// Products CRUD
router.post('/products', async (req, res) => {
  const { name, priceCents, defaultDurationDays = 30, enabled = true } = req.body || {};
  if (!name || typeof priceCents !== 'number') return res.status(400).json({ error: 'invalid_payload' });
  try {
    if (!process.env.DATABASE_URL) return res.status(501).json({ error: 'not_supported' });
    const p = await prisma.product.create({ data: { name: String(name), priceCents: Math.max(0, Math.floor(priceCents)), defaultDurationDays: Math.max(1, Number(defaultDurationDays) || 30), enabled: !!enabled } });
    await logAudit(req.user.sub, `Created product ${p.name}`, 'Product', p.id);
    return res.json({ item: p });
  } catch (e) {
    return res.status(500).json({ error: 'create_error' });
  }
});

router.patch('/products/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  const { name, priceCents, defaultDurationDays, enabled } = req.body || {};
  try {
    if (!process.env.DATABASE_URL) return res.status(501).json({ error: 'not_supported' });
    const data = {};
    if (name !== undefined) data.name = String(name);
    if (priceCents !== undefined) data.priceCents = Math.max(0, Math.floor(Number(priceCents)));
    if (defaultDurationDays !== undefined) data.defaultDurationDays = Math.max(1, Number(defaultDurationDays));
    if (enabled !== undefined) data.enabled = !!enabled;
    const p = await prisma.product.update({ where: { id }, data });
    await logAudit(req.user.sub, `Updated product ${p.id}`, 'Product', p.id, data);
    return res.json({ item: p });
  } catch (e) {
    return res.status(500).json({ error: 'update_error' });
  }
});

router.delete('/products/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  try {
    if (!process.env.DATABASE_URL) return res.status(501).json({ error: 'not_supported' });
    // Prefer soft-disable instead of hard delete in production; here allow delete for scaffold
    await prisma.product.delete({ where: { id } });
    await logAudit(req.user.sub, `Deleted product ${id}`, 'Product', id);
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'delete_error' });
  }
});

router.post('/users/:id/block', async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  try {
    if (!process.env.DATABASE_URL) return res.status(501).json({ error: 'not_supported' });
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return res.status(404).json({ error: 'not_found' });
    await prisma.user.update({ where: { id }, data: { statusBlocked: true } });
    await logAudit(req.user.sub, `Blocked user ${id}`, 'User', id);
    if (user.telegramId) await banInGroup(user.telegramId);
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'block_error' });
  }
});

router.post('/users/:id/unblock', async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  try {
    if (!process.env.DATABASE_URL) return res.status(501).json({ error: 'not_supported' });
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return res.status(404).json({ error: 'not_found' });
    await prisma.user.update({ where: { id }, data: { statusBlocked: false } });
    await logAudit(req.user.sub, `Unblocked user ${id}`, 'User', id);
    if (user.telegramId) await unbanInGroup(user.telegramId);
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'unblock_error' });
  }
});

router.post('/users/:id/role', async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  const { role } = req.body || {};
  if (!role) return res.status(400).json({ error: 'invalid_payload' });
  try {
    if (!process.env.DATABASE_URL) return res.status(501).json({ error: 'not_supported' });
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return res.status(404).json({ error: 'not_found' });
    if (!['User','Reseller','Admin'].includes(String(role))) return res.status(400).json({ error: 'invalid_role' });
    await prisma.user.update({ where: { id }, data: { role: String(role) } });
    await logAudit(req.user.sub, `Updated role of user ${id} to ${role}`, 'User', id);
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'role_error' });
  }
});

router.post('/users/:id/password', async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'invalid_payload' });
  try {
    if (!process.env.DATABASE_URL) return res.status(501).json({ error: 'not_supported' });
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return res.status(404).json({ error: 'not_found' });
    const hashedPassword = await bcrypt.hash(password, 10);
    await prisma.user.update({ where: { id }, data: { passwordHash: hashedPassword } });
    await logAudit(req.user.sub, `Updated password of user ${id}`, 'User', id);
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'password_error' });
  }
});

module.exports = router;
