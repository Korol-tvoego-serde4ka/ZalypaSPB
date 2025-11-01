const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';
const COOKIE_NAME = process.env.COOKIE_NAME || 'access_token';
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PROD = NODE_ENV === 'production';

module.exports = {
  JWT_SECRET,
  COOKIE_NAME,
  COOKIE_SECURE,
  IS_PROD,
};
