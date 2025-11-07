const express = require('express');
const router = express.Router();
const { requireAuth, requireRoles } = require('../middleware/auth');
const { prisma } = require('../db/client');
const { sendMessage, getBotUsername, inlineKeyboardWithWebApp } = require('../services/telegram');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');

// Telegram webhook endpoint (set via BotFather or setWebhook)
router.post('/webhook', async (req, res) => {
  try {
    const update = req.body || {};
    const msg = update.message || update.edited_message || null;
    if (msg && msg.chat && msg.chat.id) {
      const chatId = msg.chat.id;
      const fromId = msg.from && msg.from.id ? String(msg.from.id) : null;
      const text = (msg.text || '').trim();
      const webAppUrl = process.env.WEBAPP_URL || '';

      if (text.startsWith('/start')) {
        const parts = text.split(' ');
        const code = parts.length > 1 ? parts[1].trim() : null;
        if (code) {
          try {
            const link = await prisma.telegramLink.findUnique({ where: { code } });
            if (!link) {
              await sendMessage(chatId, 'Код не найден или уже использован.');
            } else if (link.expiresAt && link.expiresAt < new Date()) {
              await sendMessage(chatId, 'Код истёк. Сгенерируйте новый в личном кабинете.');
            } else if (link.usedAt) {
              await sendMessage(chatId, 'Этот код уже использован ранее.');
            } else {
              // Привязываем телеграм к пользователю
              try {
                await prisma.$transaction(async (tx) => {
                  await tx.user.update({ where: { id: link.userId }, data: { telegramId: fromId } });
                  await tx.telegramLink.update({ where: { id: link.id }, data: { usedAt: new Date() } });
                });
                const keyboard = webAppUrl ? { reply_markup: inlineKeyboardWithWebApp('Открыть панель', webAppUrl) } : {};
                await sendMessage(chatId, 'Готово! Telegram привязан к вашему аккаунту.', keyboard);
              } catch (e) {
                await sendMessage(chatId, 'Не удалось привязать Telegram. Возможно, этот Telegram уже связан с другим аккаунтом.');
              }
            }
          } catch (_) {
            await sendMessage(chatId, 'Ошибка ссылки. Попробуйте позже.');
          }
        } else {
          const keyboard = webAppUrl ? { reply_markup: inlineKeyboardWithWebApp('Открыть панель', webAppUrl) } : {};
          await sendMessage(chatId, 'Добро пожаловать! Используйте /help для подсказок.', keyboard);
        }
      } else if (text === '/help') {
        const help = [
          'Команды:',
          '/start — приветствие',
          '/start <code> — привязать Telegram к аккаунту (код получите в кабинете)',
          '/unlink — отвязать Telegram от аккаунта',
        ].join('\n');
        const keyboard = webAppUrl ? { reply_markup: inlineKeyboardWithWebApp('Открыть панель', webAppUrl) } : {};
        await sendMessage(chatId, help, keyboard);
      } else if (text === '/unlink') {
        try {
          const user = await prisma.user.findUnique({ where: { telegramId: fromId } });
          if (!user) {
            await sendMessage(chatId, 'Ваш Telegram не найден среди привязанных аккаунтов.');
          } else {
            const pending = await prisma.telegramUnlinkRequest.findFirst({ where: { userId: user.id, status: 'PENDING' } });
            if (pending) {
              await sendMessage(chatId, 'У вас уже есть активная заявка на отвязку. Ожидайте решения администратора.');
            } else {
              await prisma.telegramUnlinkRequest.create({ data: { userId: user.id, reason: 'Запрос через бота' } });
              await sendMessage(chatId, 'Заявка на отвязку создана и отправлена на модерацию.');
            }
          }
        } catch (_) {
          await sendMessage(chatId, 'Ошибка обработки заявки. Попробуйте позже.');
        }
      } else {
        // Нейтральный ответ
        const keyboard = webAppUrl ? { reply_markup: inlineKeyboardWithWebApp('Открыть панель', webAppUrl) } : {};
        await sendMessage(chatId, 'Я вас понял. Используйте /help для списка команд.', keyboard);
      }
    }
  } catch (_) {}
  return res.json({ ok: true });
});

// Admin-triggered broadcast
router.post(
  '/broadcast',
  requireAuth,
  requireRoles('Admin'),
  [
    body('text').isString().trim().isLength({ min: 1, max: 4000 }),
    body('roles').optional().isArray(),
    body('roles.*').optional().isString().isIn(['User','Reseller','Admin']),
    body('include_group').optional().isBoolean(),
    validate,
  ],
  async (req, res) => {
  const { text, roles, include_group } = req.body || {};
  if (!process.env.DATABASE_URL) return res.status(501).json({ error: 'not_supported' });
  try {
    const where = { telegramId: { not: null } };
    if (Array.isArray(roles) && roles.length > 0) where.role = { in: roles };
    const users = await prisma.user.findMany({ where, select: { telegramId: true, id: true } });
    let sent = 0, failed = 0;
    // Send in small batches to avoid rate limits
    const batchSize = 25;
    for (let i = 0; i < users.length; i += batchSize) {
      const batch = users.slice(i, i + batchSize);
      await Promise.all(batch.map(async (u) => {
        try { await sendMessage(u.telegramId, text); sent++; } catch (_) { failed++; }
      }));
      // small delay between batches
      await new Promise(r => setTimeout(r, 200));
    }
    // Optionally send to group
    if (include_group && process.env.TELEGRAM_GROUP_ID) {
      try { await sendMessage(process.env.TELEGRAM_GROUP_ID, text); sent++; } catch (_) { failed++; }
    }
    return res.json({ sent, failed, recipients: users.length });
  } catch (e) {
    return res.status(500).json({ error: 'broadcast_error' });
  }
});

// Start linking: returns deep link t.me/<bot>?start=<code>
router.post('/link/start', requireAuth, async (req, res) => {
  try {
    const code = require('crypto').randomBytes(8).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 час
    await prisma.telegramLink.create({ data: { code, userId: req.user.sub, expiresAt } });
    const username = await getBotUsername();
    if (!username) return res.status(500).json({ error: 'bot_unavailable' });
    const link = `https://t.me/${username}?start=${code}`;
    return res.json({ link, code, expires_at: expiresAt.toISOString() });
  } catch (e) {
    return res.status(500).json({ error: 'link_error' });
  }
});

// Linking status
router.get('/link/status', requireAuth, async (req, res) => {
  try {
    const u = await prisma.user.findUnique({ where: { id: req.user.sub } });
    return res.json({ linked: !!(u && u.telegramId), telegramId: u && u.telegramId ? u.telegramId : null });
  } catch (_) {
    return res.json({ linked: false, telegramId: null });
  }
});

// Unlink from web
router.post(
  '/link/unlink',
  requireAuth,
  [ body('reason').optional().isString().isLength({ max: 500 }), validate ],
  async (req, res) => {
    try {
      const { reason } = req.body || {};
      const pending = await prisma.telegramUnlinkRequest.findFirst({ where: { userId: req.user.sub, status: 'PENDING' } });
      if (pending) return res.status(409).json({ error: 'already_pending' });
      const r = await prisma.telegramUnlinkRequest.create({ data: { userId: req.user.sub, reason: reason ? String(reason).slice(0, 500) : null } });
      return res.json({ ok: true, request_id: r.id });
    } catch (_) {
      return res.status(500).json({ error: 'unlink_error' });
    }
});

// Admin: list unlink requests
router.get('/unlink/requests', requireAuth, requireRoles('Admin'), async (_req, res) => {
  try {
    const items = await prisma.telegramUnlinkRequest.findMany({ include: { user: true }, orderBy: { createdAt: 'desc' }, take: 200 });
    return res.json({ items: items.map(i => ({ id: i.id, user: { id: i.userId, username: i.user.username }, status: i.status, reason: i.reason, createdAt: i.createdAt }) ) });
  } catch(_) { return res.json({ items: [] }); }
});

// Admin: approve unlink
router.post('/unlink/requests/:id/approve', requireAuth, requireRoles('Admin'), async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  try {
    const r = await prisma.telegramUnlinkRequest.findUnique({ where: { id } });
    if (!r || r.status !== 'PENDING') return res.status(404).json({ error: 'not_found' });
    await prisma.$transaction(async (tx) => {
      await tx.telegramUnlinkRequest.update({ where: { id }, data: { status: 'APPROVED', resolvedAt: new Date() } });
      await tx.user.update({ where: { id: r.userId }, data: { telegramId: null } });
    });
    return res.json({ ok: true });
  } catch(_) { return res.status(500).json({ error: 'approve_error' }); }
});

// Admin: reject unlink
router.post('/unlink/requests/:id/reject', requireAuth, requireRoles('Admin'), async (req, res) => {
  const id = Number(req.params.id);
  const { reason } = req.body || {};
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  try {
    const r = await prisma.telegramUnlinkRequest.findUnique({ where: { id } });
    if (!r || r.status !== 'PENDING') return res.status(404).json({ error: 'not_found' });
    await prisma.telegramUnlinkRequest.update({ where: { id }, data: { status: 'REJECTED', resolvedAt: new Date(), reason: reason ? String(reason).slice(0, 500) : r.reason } });
    return res.json({ ok: true });
  } catch(_) { return res.status(500).json({ error: 'reject_error' }); }
});

module.exports = router;
