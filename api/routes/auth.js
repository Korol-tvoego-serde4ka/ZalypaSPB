const express = require('express');
const router = express.Router();
const { signToken } = require('../middleware/auth');
const { COOKIE_NAME, COOKIE_SECURE, IS_PROD } = require('../config');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config');
const bcrypt = require('bcryptjs');
const { prisma } = require('../db/client');
const { logAudit } = require('../utils/audit');
const { checkWebAppData, extractTelegramUser } = require('../services/telegram');
const { body, validationResult } = require('express-validator');
const { validate } = require('../middleware/validate');

// No demo fallback: DB-only

router.post('/login', [
  body('username').isString().trim().isLength({ min: 1, max: 64 }),
  body('password').isString().isLength({ min: 1, max: 200 }),
  validate,
], async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'invalid_credentials' });
  try {
    const dbUser = await prisma.user.findUnique({ where: { username } });
    if (!dbUser || !dbUser.passwordHash) return res.status(401).json({ error: 'invalid_credentials' });
    const ok = await bcrypt.compare(password, dbUser.passwordHash);
    if (!ok) return res.status(401).json({ error: 'invalid_credentials' });
    const token = signToken({ sub: dbUser.id, username: dbUser.username, role: dbUser.role });
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      secure: COOKIE_SECURE || IS_PROD,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });
    return res.json({ user: { id: dbUser.id, username: dbUser.username, role: dbUser.role, email: dbUser.email || null } });
  } catch (e) {
    return res.status(500).json({ error: 'login_error' });
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, secure: COOKIE_SECURE || IS_PROD, sameSite: 'lax', path: '/' });
  res.json({ ok: true });
});

router.get('/me', async (req, res) => {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) return res.json({ user: null });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const dbUser = await prisma.user.findUnique({ where: { id: decoded.sub } });
    if (!dbUser) return res.json({ user: null });
    return res.json({ user: { id: dbUser.id, username: dbUser.username, role: dbUser.role, email: dbUser.email || null } });
  } catch (_) {
    return res.json({ user: null });
  }
});

router.post('/telegram/webapp', [
  body('initData').isString().isLength({ min: 10 }),
  body('invite').optional().isString().isLength({ min: 1, max: 128 }),
  validate,
], async (req, res) => {
  const { initData, invite } = req.body || {};
  if (!process.env.DATABASE_URL) return res.status(501).json({ error: 'not_supported' });
  if (!initData) return res.status(400).json({ error: 'invalid_payload' });
  try {
    if (!checkWebAppData(initData)) return res.status(401).json({ error: 'invalid_signature' });
    const tg = extractTelegramUser(initData);
    if (!tg) return res.status(400).json({ error: 'invalid_tg_data' });

    // Try to find existing linked user
    let user = await prisma.user.findUnique({ where: { telegramId: String(tg.id) } });
    if (!user) {
      // If no link, allow registration only with invite
      if (!invite) return res.status(403).json({ error: 'invite_required' });
      const inv = await prisma.invite.findUnique({ where: { code: String(invite) } });
      if (!inv) return res.status(404).json({ error: 'invite_not_found' });
      if (inv.revoked) return res.status(410).json({ error: 'invite_revoked' });
      if (inv.usedById) return res.status(409).json({ error: 'invite_used' });
      if (inv.expiresAt && inv.expiresAt < new Date()) return res.status(410).json({ error: 'invite_expired' });

      user = await prisma.$transaction(async (tx) => {
        const created = await tx.user.create({ data: { username: tg.username ? `tg_${tg.username}` : `tg_${tg.id}`, email: null, passwordHash: null, role: 'User', telegramId: String(tg.id) } });
        await tx.invite.update({ where: { id: inv.id }, data: { usedById: created.id, usedAt: new Date() } });
        return created;
      });
      await logAudit(user.id, 'User registered via Telegram WebApp', 'User', user.id, { telegramId: tg.id });
    }

    const token = signToken({ sub: user.id, username: user.username, role: user.role });
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      secure: COOKIE_SECURE || IS_PROD,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });
    return res.json({ user: { id: user.id, username: user.username, role: user.role, email: user.email || null, telegramId: user.telegramId } });
  } catch (e) {
    return res.status(500).json({ error: 'telegram_login_error' });
  }
});

router.post('/register', [
  body('username').isString().trim().isLength({ min: 3, max: 64 }),
  body('email').optional().isEmail().isLength({ max: 120 }),
  body('password').isString().isLength({ min: 6, max: 200 }),
  body('invite').isString().isLength({ min: 1, max: 128 }),
  validate,
], async (req, res) => {
  const { username, email, password, invite } = req.body || {};
  if (!username || !password || !invite) return res.status(400).json({ error: 'invalid_payload' });
  if (!process.env.DATABASE_URL) return res.status(501).json({ error: 'not_supported' });
  try {
    const inv = await prisma.invite.findUnique({ where: { code: String(invite) } });
    if (!inv) return res.status(404).json({ error: 'invite_not_found' });
    if (inv.revoked) return res.status(410).json({ error: 'invite_revoked' });
    if (inv.usedById) return res.status(409).json({ error: 'invite_used' });
    if (inv.expiresAt && inv.expiresAt < new Date()) return res.status(410).json({ error: 'invite_expired' });

    const passwordHash = await bcrypt.hash(password, 10);
    const created = await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({ data: { username: String(username), email: email ? String(email) : null, passwordHash, role: 'User' } });
      await tx.invite.update({ where: { id: inv.id }, data: { usedById: u.id, usedAt: new Date() } });
      return u;
    });
    await logAudit(created.id, 'User registered via invite', 'User', created.id, { invite: inv.code });
    const token = signToken({ sub: created.id, username: created.username, role: created.role });
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      secure: COOKIE_SECURE || IS_PROD,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });
    return res.json({ user: { id: created.id, username: created.username, role: created.role, email: created.email || null } });
  } catch (e) {
    if (e.code === 'P2002') return res.status(409).json({ error: 'username_or_email_taken' });
    return res.status(500).json({ error: 'register_error' });
  }
});

module.exports = router;
