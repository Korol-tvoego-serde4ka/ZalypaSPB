require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const authRoutes = require('./api/routes/auth');
const productsRoutes = require('./api/routes/products');
const keysRoutes = require('./api/routes/keys');
const loaderRoutes = require('./api/routes/loader');
const adminRoutes = require('./api/routes/admin');
const resellerRoutes = require('./api/routes/reseller');
const meRoutes = require('./api/routes/me');
const telegramRoutes = require('./api/routes/telegram');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy (Nginx)
app.set('trust proxy', 1);

// Security headers
app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
        connectSrc: ["'self'", 'https://fonts.gstatic.com'],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      },
    },
  })
);

// Compression
app.use(compression());
app.use(express.json());
app.use(cookieParser());

// Rate limiting
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });
app.use('/api', apiLimiter);
app.use('/api/auth', authLimiter);

app.use('/api/auth', authRoutes);
app.use('/api/me', meRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/keys', keysRoutes);
app.use('/api/loader', loaderRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/reseller', resellerRoutes);
app.use('/api/telegram', telegramRoutes);

// Static assets with caching
const publicDir = path.join(__dirname, 'public');
app.use(
  express.static(publicDir, {
    etag: true,
    lastModified: true,
    setHeaders: (res, filePath) => {
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        // Long-term cache for versioned assets
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else {
        // HTML: no-cache
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  })
);

// Downloads (loader binaries)
const downloadsDir = path.join(__dirname, 'downloads');
app.use(
  '/downloads',
  express.static(downloadsDir, {
    etag: true,
    lastModified: true,
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    },
  })
);

// Health check
app.get('/healthz', (_req, res) => {
  res.json({ status: 'ok' });
});

// Fallback to index.html (SPA)
app.get('*', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
