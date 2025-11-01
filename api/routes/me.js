const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { prisma } = require('../db/client');

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

module.exports = router;
