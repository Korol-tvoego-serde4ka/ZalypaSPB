const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config');

function signToken(payload, options = {}) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d', ...options });
}

function getTokenFromReq(req) {
  const token = req.cookies && req.cookies[process.env.COOKIE_NAME || 'access_token'];
  return token || null;
}

function authOptional(req, _res, next) {
  const token = getTokenFromReq(req);
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded;
    } catch (_) {}
  }
  next();
}

function requireAuth(req, res, next) {
  const token = getTokenFromReq(req);
  if (!token) return res.status(401).json({ error: 'unauthorized' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    return next();
  } catch (_) {
    return res.status(401).json({ error: 'unauthorized' });
  }
}

function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'unauthorized' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'forbidden' });
    next();
  };
}

module.exports = { signToken, authOptional, requireAuth, requireRoles };
