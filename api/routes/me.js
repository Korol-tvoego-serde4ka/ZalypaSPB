const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { prisma } = require('../db/client');
const bcrypt = require('bcryptjs');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { logAudit } = require('../utils/audit');

router.get('/', requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
    if (!user) return res.status(404).json({ error: 'not_found' });
    return res.json({ user: { id: user.id, username: user.username, role: user.role, email: user.email || null, status: user.statusBlocked ? 'Заблокирован' : 'Активен' } });
  } catch (_) {
    return res.status(500).json({ error: 'me_error' });
  }
});

router.get('/subscriptions', requireAuth, async (req, res) => {
  try {
    if (process.env.DATABASE_URL) {
      const subs = await prisma.subscription.findMany({
        where: { userId: req.user.sub },
        include: { product: true },
        orderBy: { expiresAt: 'desc' },
      });
      const now = new Date();
      const items = subs.map(s => ({
        id: s.id,
        product: { id: s.productId, name: s.product.name },
        expires_at: s.expiresAt.toISOString(),
        active: s.expiresAt > now && s.status === 'ACTIVE',
      }));
      return res.json({ items });
    }
  } catch (_) {}
  return res.json({ items: [] });
});

// Self-service password change
router.post(
  '/password',
  requireAuth,
  [
    body('newPassword').isString().isLength({ min: 6, max: 200 }),
    body('currentPassword').optional().isString().isLength({ min: 0, max: 200 }),
    validate,
  ],
  async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body || {};
      const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
      if (!user) return res.status(404).json({ error: 'not_found' });
      // If user has an existing password, verify it; otherwise allow setting without current
      if (user.passwordHash) {
        if (!currentPassword) return res.status(400).json({ error: 'current_required' });
        const ok = await bcrypt.compare(String(currentPassword), user.passwordHash);
        if (!ok) return res.status(401).json({ error: 'invalid_current' });
      }
      const hashed = await bcrypt.hash(String(newPassword), 10);
      await prisma.user.update({ where: { id: user.id }, data: { passwordHash: hashed } });
      await logAudit(user.id, 'User changed own password', 'User', user.id);
      return res.json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: 'password_change_error' });
    }
  }
);

module.exports = router;
