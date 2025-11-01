const crypto = require('crypto');

function getBotToken() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN not set');
  return token;
}

function getApiBase() {
  return process.env.TELEGRAM_API_BASE || 'https://api.telegram.org';
}

async function call(method, params) {
  const token = getBotToken();
  const url = `${getApiBase()}/bot${token}/${method}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (data && data.ok === false)) {
    const err = new Error('telegram_api_error');
    err.response = data;
    throw err;
  }
  return data.result;
}

async function sendMessage(chatId, text, options = {}) {
  return call('sendMessage', { chat_id: chatId, text, parse_mode: options.parse_mode || 'HTML', disable_web_page_preview: true, ...options });
}

let botUsernameCache = null;
async function getBotUsername() {
  if (botUsernameCache) return botUsernameCache;
  const me = await call('getMe', {});
  botUsernameCache = me && me.username ? me.username : null;
  return botUsernameCache;
}

function inlineKeyboardWithWebApp(text, url) {
  return {
    inline_keyboard: [
      [ { text, web_app: { url } } ],
    ],
  };
}

async function banInGroup(userId) {
  const chatId = process.env.TELEGRAM_GROUP_ID;
  if (!chatId) return false;
  try {
    await call('banChatMember', { chat_id: chatId, user_id: Number(userId) });
    return true;
  } catch (_) {
    return false;
  }
}

async function unbanInGroup(userId) {
  const chatId = process.env.TELEGRAM_GROUP_ID;
  if (!chatId) return false;
  try {
    await call('unbanChatMember', { chat_id: chatId, user_id: Number(userId), only_if_banned: true });
    return true;
  } catch (_) {
    return false;
  }
}

// Telegram WebApp login verification
// See: https://core.telegram.org/bots/webapps#validating-data-received-via-the-web-app
function parseInitData(initData) {
  const params = {};
  for (const part of String(initData).split('&')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = decodeURIComponent(part.slice(0, idx));
    const value = decodeURIComponent(part.slice(idx + 1));
    params[key] = value;
  }
  return params;
}

function checkWebAppData(initData) {
  const token = getBotToken();
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  const data = parseInitData(initData);
  const sentHash = data.hash;
  if (!sentHash) return false;
  const entries = Object.keys(data)
    .filter((k) => k !== 'hash')
    .sort()
    .map((k) => `${k}=${data[k]}`)
    .join('\n');
  const calcHash = crypto.createHmac('sha256', secret).update(entries).digest('hex');
  return calcHash === sentHash;
}

function extractTelegramUser(initData) {
  const data = parseInitData(initData);
  try {
    if (data.user) {
      const user = JSON.parse(data.user);
      return { id: String(user.id), username: user.username || null, first_name: user.first_name || null, last_name: user.last_name || null };
    }
  } catch (_) {}
  return null;
}

module.exports = { sendMessage, banInGroup, unbanInGroup, checkWebAppData, extractTelegramUser, getBotUsername, inlineKeyboardWithWebApp };
