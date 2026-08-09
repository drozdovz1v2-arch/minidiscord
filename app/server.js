const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');
const { WebSocketServer } = require('ws');

let electronApp = null;
try {
  ({ app: electronApp } = require('electron'));
} catch (_) {
  electronApp = null;
}

function ensureDirEarly(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function getEnvFileCandidates() {
  const candidates = [];

  if (electronApp && typeof electronApp.getPath === 'function') {
    try {
      candidates.push(path.join(electronApp.getPath('userData'), '.env'));
      candidates.push(path.join(path.dirname(electronApp.getPath('exe')), '.env'));
    } catch (_) {}
  }

  candidates.push(path.join(__dirname, '..', '.env'));
  candidates.push(path.join(process.cwd(), '.env'));
  return [...new Set(candidates)];
}

function syncProjectEnvToUserData() {
  if (!electronApp || typeof electronApp.getPath !== 'function') return;

  const projectEnv = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(projectEnv)) return;

  const userEnv = path.join(electronApp.getPath('userData'), '.env');
  if (fs.existsSync(userEnv)) return;

  ensureDirEarly(path.dirname(userEnv));
  fs.copyFileSync(projectEnv, userEnv);
  console.log('📧 .env скопирован в', userEnv);
}

function loadEnvironment() {
  syncProjectEnvToUserData();

  const dotenv = require('dotenv');
  for (const envPath of getEnvFileCandidates()) {
    if (!fs.existsSync(envPath)) continue;
    dotenv.config({ path: envPath, override: true });
    console.log('📧 .env загружен:', envPath);
    loadedEnvPath = envPath;
    return envPath;
  }

  console.log('📧 .env не найден. Создай файл .env рядом с MiniDiscord.exe или в папке проекта wq');
  return null;
}

let loadedEnvPath = null;

loadEnvironment();

const CONFIG = require('../config');
const {
  getLocalIPv4List,
  pickVpnHostIp,
  getVpnNetworkInfo
} = require('../network');
const { startDiscoveryService } = require('../discovery');

const webApp = express();
webApp.use(express.json({ limit: '10mb' }));
webApp.use(express.urlencoded({ extended: true }));
webApp.use(express.static(path.join(__dirname, 'public')));

webApp.get('/', (req, res) => {
  res.send('MiniDiscord server работает');
});

webApp.get('/server-info', (_req, res) => {
  const vpn = getVpnNetworkInfo();
  const host = pickBestServerIp();

  res.json({
    ok: true,
    host,
    httpPort: CONFIG.HTTP_PORT,
    voicePort: CONFIG.VOICE_PORT,
    apiBase: `http://${host}:${CONFIG.HTTP_PORT}`,
    wsTextUrl: `ws://${host}:${CONFIG.HTTP_PORT}`,
    wsVoiceUrl: `ws://${host}:${CONFIG.VOICE_PORT}`,
    hasVpn: vpn.hasVpn,
    vpnAdapters: vpn.vpnAdapters,
    ipv4: getLocalIPv4List()
  });
});

webApp.get('/mail-status', (_req, res) => {
  res.json({
    ok: true,
    configured: isMailConfigured(),
    verified: mailTransportVerified,
    provider: isGmailAccount() ? 'gmail' : 'smtp',
    requireEmailVerification: REQUIRE_EMAIL_VERIFICATION,
    envPath: loadedEnvPath,
    host: isMailConfigured() ? (isGmailAccount() ? 'gmail' : MAIL_CONFIG.host) : null,
    from: isMailConfigured() ? getMailFromAddress() : null,
    user: isMailConfigured() ? MAIL_CONFIG.user : null
  });
});

function cloneFallback(value) {
  return JSON.parse(JSON.stringify(value));
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function getDataDir() {
  const baseDir =
    electronApp && typeof electronApp.getPath === 'function'
      ? electronApp.getPath('userData')
      : __dirname;

  const dir = path.join(baseDir, 'data');
  ensureDir(dir);
  return dir;
}

const DATA_DIR = getDataDir();
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const GLOBAL_MESSAGES_FILE = path.join(DATA_DIR, 'globalMessages.json');
const DM_MESSAGES_FILE = path.join(DATA_DIR, 'dmMessages.json');
const FRIEND_REQUESTS_FILE = path.join(DATA_DIR, 'friendRequests.json');
const FRIENDS_FILE = path.join(DATA_DIR, 'friends.json');
const PROFILES_FILE = path.join(DATA_DIR, 'profiles.json');
const loginAttempts = {};

const MAIL_CONFIG = {
  host: process.env.MAIL_HOST || 'smtp.gmail.com',
  port: Number(process.env.MAIL_PORT || 587),
  secure: String(process.env.MAIL_SECURE || 'false') === 'true',
  user: process.env.MAIL_USER || '',
  pass: process.env.MAIL_PASS || '',
  from: process.env.MAIL_FROM || process.env.MAIL_USER || ''
};

const REQUIRE_EMAIL_VERIFICATION =
  String(process.env.REQUIRE_EMAIL_VERIFICATION || 'true').toLowerCase() !== 'false';

const MAIL_DEV_SHOW_CODE =
  String(process.env.MAIL_DEV_SHOW_CODE || 'false').toLowerCase() === 'true';

let mailTransport = null;
let mailTransportVerified = false;

function normalizeMailSecret(value) {
  return String(value || '').trim().replace(/\s+/g, '');
}

function isGmailAccount() {
  const host = String(MAIL_CONFIG.host || '').toLowerCase();
  const user = String(MAIL_CONFIG.user || '').toLowerCase();
  return host.includes('gmail.com') || user.endsWith('@gmail.com');
}

function getMailFromAddress() {
  const user = String(MAIL_CONFIG.user || '').trim();
  let from = String(MAIL_CONFIG.from || user).trim();

  if (!user) return from || 'MiniDiscord';

  if (isGmailAccount()) {
    const match = from.match(/<([^>]+)>/);
    const fromEmail = (match ? match[1] : from).trim().toLowerCase();
    if (fromEmail !== user.toLowerCase()) {
      from = `MiniDiscord <${user}>`;
    }
  }

  return from || `MiniDiscord <${user}>`;
}

function isMailConfigured() {
  return !!(MAIL_CONFIG.user && MAIL_CONFIG.pass);
}

function getMailTransport() {
  if (mailTransport) return mailTransport;

  if (!isMailConfigured()) {
    return null;
  }

  const user = String(MAIL_CONFIG.user).trim();
  const pass = normalizeMailSecret(MAIL_CONFIG.pass);

  if (isGmailAccount()) {
    mailTransport = nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass }
    });
    return mailTransport;
  }

  mailTransport = nodemailer.createTransport({
    host: MAIL_CONFIG.host,
    port: MAIL_CONFIG.port,
    secure: MAIL_CONFIG.secure,
    auth: { user, pass },
    tls: {
      minVersion: 'TLSv1.2'
    }
  });

  return mailTransport;
}

async function verifyMailTransport() {
  if (!isMailConfigured()) {
    console.log('📧 Почта: SMTP не настроен (.env → MAIL_USER / MAIL_PASS)');
    console.log('   Код подтверждения будет показан в ответе приложения (режим без SMTP)');
    return false;
  }

  try {
    const transport = getMailTransport();
    await transport.verify();
    mailTransportVerified = true;
    const via = isGmailAccount() ? 'Gmail API' : `${MAIL_CONFIG.host}:${MAIL_CONFIG.port}`;
    console.log(`📧 Почта: SMTP OK (${via}, from ${getMailFromAddress()})`);
    return true;
  } catch (err) {
    mailTransportVerified = false;
    mailTransport = null;
    console.error('📧 Почта: ошибка SMTP-подключения:', err?.message || err);
    console.error('   Проверь MAIL_USER, MAIL_PASS и для Gmail — пароль приложения');
    return false;
  }
}

function buildMailClientPayload(result) {
  if (!result) return {};

  if (result.simulated) {
    return {
      mailSimulated: true,
      devCode: result.devCode || undefined,
      message:
        result.message ||
        'SMTP не настроен на сервере. Код показан ниже — или настрой .env у хоста.'
    };
  }

  return {
    mailSimulated: false,
    message: 'Код отправлен на почту. Проверь «Входящие» и «Спам».'
  };
}

function generateEmailCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function pickBestServerIp() {
  return pickVpnHostIp();
}

function getPublicBaseUrl() {
  if (process.env.PUBLIC_BASE_URL) {
    return process.env.PUBLIC_BASE_URL.replace(/\/$/, '');
  }

  const hostIp = pickBestServerIp();
  return `http://${hostIp}:${CONFIG.HTTP_PORT}`;
}

async function sendVerificationEmail(email, username, code) {
  console.log('📨 Пытаюсь отправить код:', email, code);

  try {
    const logPath = path.join(__dirname, 'mail-debug.log');
    fs.appendFileSync(
      logPath,
      `[${new Date().toISOString()}] TRY verify email=${email} username=${username} code=${code}\n`
    );
  } catch (_) {}

  const transport = getMailTransport();

  if (!transport) {
    console.log(`[MAIL FALLBACK] verify code for ${username} <${email}>: ${code}`);

    try {
      const logPath = path.join(__dirname, 'mail-debug.log');
      fs.appendFileSync(
        logPath,
        `[${new Date().toISOString()}] FALLBACK verify username=${username} email=${email} code=${code}\n`
      );
    } catch (_) {}

    return {
      ok: true,
      simulated: true,
      devCode: MAIL_DEV_SHOW_CODE ? code : undefined,
      message: 'SMTP не настроен. Код показан в приложении.'
    };
  }

  try {
    await transport.sendMail({
      from: getMailFromAddress(),
      to: email,
      replyTo: MAIL_CONFIG.user,
      subject: 'MiniDiscord — код подтверждения',
      text:
`Здравствуйте!

Ваш код подтверждения MiniDiscord: ${code}

Код действует 10 минут.

Если это были не вы, просто проигнорируйте это письмо.`,
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111">
          <h2>MiniDiscord</h2>
          <p>Ваш код подтверждения:</p>
          <div style="font-size:32px;font-weight:700;letter-spacing:6px;margin:16px 0">${code}</div>
          <p>Код действует 10 минут.</p>
        </div>
      `
    });

    try {
      const logPath = path.join(__dirname, 'mail-debug.log');
      fs.appendFileSync(
        logPath,
        `[${new Date().toISOString()}] OK verify email sent to=${email} username=${username}\n`
      );
    } catch (_) {}
  } catch (err) {
    console.error('sendVerificationEmail error:', err);

    try {
      const logPath = path.join(__dirname, 'mail-debug.log');
      fs.appendFileSync(
        logPath,
        `[${new Date().toISOString()}] ERROR verify to=${email} username=${username} error=${err?.stack || err}\n`
      );
    } catch (_) {}

    throw err;
  }

  return { ok: true };
}

async function sendResetPasswordEmail(email, username, token) {
  const transport = getMailTransport();
  const resetUrl = `${getPublicBaseUrl()}/reset-password.html?token=${token}`;

  if (!transport) {
    console.log(`[MAIL FALLBACK] reset link for ${username} <${email}>: ${resetUrl}`);
    return { ok: true, simulated: true };
  }

  await transport.sendMail({
    from: getMailFromAddress(),
    to: email,
    replyTo: MAIL_CONFIG.user,
    subject: 'MiniDiscord — восстановление пароля',
    text:
`Здравствуйте!

Вы запросили восстановление пароля MiniDiscord.

Откройте ссылку:
${resetUrl}

Ссылка действует 1 час.

Если это были не вы, просто проигнорируйте это письмо.`,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111">
        <h2>MiniDiscord</h2>
        <p>Вы запросили восстановление пароля.</p>
        <p>
          <a href="${resetUrl}" style="display:inline-block;padding:12px 18px;background:#5b64f5;color:#fff;text-decoration:none;border-radius:10px;">
            Сменить пароль
          </a>
        </p>
        <p>Или откройте ссылку вручную:</p>
        <p>${resetUrl}</p>
        <p>Ссылка действует 1 час.</p>
      </div>
    `
  });

  return { ok: true };
}

function ensureJsonFile(file, fallback) {
  const dir = path.dirname(file);
  ensureDir(dir);

  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(fallback, null, 2), 'utf8');
  }
}

function readJson(file, fallback) {
  try {
    ensureJsonFile(file, fallback);
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error(`readJson error: ${file}`, e);
    return cloneFallback(fallback);
  }
}

function writeJson(file, data) {
  try {
    ensureJsonFile(file, data);
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error(`writeJson error: ${file}`, e);
    throw e;
  }
}

let users = readJson(USERS_FILE, {});
let sessions = readJson(SESSIONS_FILE, {});
let globalMessages = readJson(GLOBAL_MESSAGES_FILE, []);
let dmMessages = readJson(DM_MESSAGES_FILE, []);
let friendRequests = readJson(FRIEND_REQUESTS_FILE, []);
let friends = readJson(FRIENDS_FILE, {});
let profiles = readJson(PROFILES_FILE, {});

function saveUsers() {
  writeJson(USERS_FILE, users);
}

function saveSessions() {
  writeJson(SESSIONS_FILE, sessions);
}

function saveGlobalMessages() {
  writeJson(GLOBAL_MESSAGES_FILE, globalMessages);
}

function saveDmMessages() {
  writeJson(DM_MESSAGES_FILE, dmMessages);
}

function saveFriendRequests() {
  writeJson(FRIEND_REQUESTS_FILE, friendRequests);
}

function saveFriends() {
  writeJson(FRIENDS_FILE, friends);
}

function saveProfiles() {
  writeJson(PROFILES_FILE, profiles);
}

function ensureUserCollections(username) {
  if (!friends[username]) friends[username] = [];
  ensureProfile(username);
}

function ensureProfile(username) {
  if (!profiles[username]) {
    profiles[username] = {
      username,
      bio: '',
      avatar: '',
      status: 'online'
    };
    saveProfiles();
  }
  return profiles[username];
}

function sanitizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

function createId() {
  return crypto.randomUUID();
}

function createToken() {
  return crypto.randomBytes(32).toString('hex');
}

function createSessionId() {
  return crypto.randomUUID();
}

function createDeviceName(rawDeviceName) {
  const safe = String(rawDeviceName || '').trim().slice(0, 120);
  return safe || 'Unknown device';
}

function getSessionByToken(token) {
  if (!token) return null;
  return sessions[token] || null;
}

function removeExpiredSessions() {
  const now = Date.now();
  let changed = false;

  Object.keys(sessions).forEach((token) => {
    const s = sessions[token];
    if (!s || !s.expiresAt || now > s.expiresAt) {
      delete sessions[token];
      changed = true;
    }
  });

  if (changed) saveSessions();
}

function getUserSessions(username) {
  removeExpiredSessions();

  return Object.entries(sessions)
    .filter(([, s]) => s && s.username === username)
    .map(([token, s]) => ({
      token,
      sessionId: s.sessionId,
      username: s.username,
      deviceName: s.deviceName || 'Unknown device',
      createdAt: s.createdAt,
      lastUsedAt: s.lastUsedAt || s.createdAt,
      expiresAt: s.expiresAt
    }))
    .sort((a, b) => Number(b.lastUsedAt || 0) - Number(a.lastUsedAt || 0));
}

function isValidStatus(status) {
  return ['online', 'away', 'dnd'].includes(status);
}

function areFriends(a, b) {
  return (friends[a] || []).includes(b) && (friends[b] || []).includes(a);
}

function getDmUnreadCount(forUser, friend) {
  return dmMessages.filter(
    (m) => m.to === forUser && m.from === friend && !m.read
  ).length;
}

function getUnreadSnapshot(forUser) {
  const snapshot = {};
  (friends[forUser] || []).forEach((friend) => {
    snapshot[friend] = getDmUnreadCount(forUser, friend);
  });
  return snapshot;
}

function sendUnreadSnapshot(username) {
  const payload = JSON.stringify({
    type: 'dm-unread-snapshot',
    unread: getUnreadSnapshot(username)
  });

  textClients
    .filter((c) => c.username === username && c.ws.readyState === 1)
    .forEach((c) => {
      try {
        c.ws.send(payload);
      } catch (_) {}
    });
}

function buildOnlineUsersPayload() {
  return Array.from(onlinePresence.keys()).map((username) => {
    const profile = ensureProfile(username);
    return {
      username,
      bio: profile.bio || '',
      avatar: profile.avatar || '',
      status: onlinePresence.get(username)?.status || profile.status || 'online'
    };
  });
}

function broadcastOnlineUsers() {
  const payload = JSON.stringify({
    type: 'online-users',
    users: buildOnlineUsersPayload()
  });

  textClients.forEach((client) => {
    try {
      if (client.ws.readyState === 1) {
        client.ws.send(payload);
      }
    } catch (_) {}
  });
}

function broadcastGlobalMessage(message) {
  const payload = JSON.stringify({
    type: 'global-message',
    message
  });

  textClients.forEach((client) => {
    try {
      if (client.ws.readyState === 1) {
        client.ws.send(payload);
      }
    } catch (_) {}
  });
}

function broadcastProfileUpdated(profile) {
  const payload = JSON.stringify({
    type: 'profile-updated',
    profile
  });

  textClients.forEach((client) => {
    try {
      if (client.ws.readyState === 1) {
        client.ws.send(payload);
      }
    } catch (_) {}
  });
}

function broadcastStatusUpdated(username, status) {
  const payload = JSON.stringify({
    type: 'status-updated',
    username,
    status
  });

  textClients.forEach((client) => {
    try {
      if (client.ws.readyState === 1) {
        client.ws.send(payload);
      }
    } catch (_) {}
  });

  broadcastOnlineUsers();
}

function sendDmToParticipants(message) {
  const payload = JSON.stringify({
    type: 'dm-message',
    message
  });

  textClients.forEach((client) => {
    try {
      if (
        client.ws.readyState === 1 &&
        (client.username === message.from || client.username === message.to)
      ) {
        client.ws.send(payload);
      }
    } catch (_) {}
  });

  sendUnreadSnapshot(message.to);
  sendUnreadSnapshot(message.from);
}

function sendDmDeleteToParticipants(message) {
  const payload = JSON.stringify({
    type: 'dm-delete',
    id: message.id,
    from: message.from,
    to: message.to
  });

  textClients.forEach((client) => {
    try {
      if (
        client.ws.readyState === 1 &&
        (client.username === message.from || client.username === message.to)
      ) {
        client.ws.send(payload);
      }
    } catch (_) {}
  });

  sendUnreadSnapshot(message.to);
  sendUnreadSnapshot(message.from);
}

function sendTyping(from, to, isTyping) {
  const payload = JSON.stringify({
    type: 'dm-typing',
    from,
    to,
    isTyping: !!isTyping
  });

  textClients.forEach((client) => {
    try {
      if (client.ws.readyState === 1 && client.username === to) {
        client.ws.send(payload);
      }
    } catch (_) {}
  });
}

function getTextClientByUsername(username) {
  return textClients.find((c) => c.username === username && c.ws.readyState === 1) || null;
}

function sendTextEventToUser(username, payload) {
  const client = getTextClientByUsername(username);
  if (!client) return false;

  try {
    client.ws.send(JSON.stringify(payload));
    return true;
  } catch (_) {
    return false;
  }
}

function createPrivateCallRoom(a, b) {
  const sorted = [a, b].sort();
  return `DM:${sorted[0]}:${sorted[1]}`;
}

function cleanupCall(callId) {
  if (!callId) return;
  activeCalls.delete(callId);
}

function removeTextClient(ws) {
  const idx = textClients.findIndex((c) => c.ws === ws);
  if (idx !== -1) {
    textClients.splice(idx, 1);
  }
}

function normalizeVoiceMembers(channelName) {
  const channel = voiceChannels.get(channelName);
  if (!channel) return [];

  return Array.from(channel.members.keys()).map((username) => {
    const member = channel.members.get(username);
    const profile = ensureProfile(username);
    return {
      username,
      muted: !!member?.muted,
      speaking: !!member?.speaking,
      avatar: profile.avatar || '',
      status: onlinePresence.get(username)?.status || profile.status || 'online'
    };
  });
}

function broadcastVoiceMembers(channelName) {
  const channel = voiceChannels.get(channelName);
  if (!channel) return;

  const payload = JSON.stringify({
    type: 'voice-members',
    members: normalizeVoiceMembers(channelName)
  });

  channel.members.forEach((info) => {
    try {
      if (info.ws.readyState === 1) {
        info.ws.send(payload);
      }
    } catch (_) {}
  });
}

function broadcastSpeaking(ws, speaking) {
  const channelName = ws.channelName;
  if (!channelName) return;

  const channel = voiceChannels.get(channelName);
  if (!channel) return;

  const member = channel.members.get(ws.username);
  if (!member) return;

  member.speaking = !!speaking;

  const payload = JSON.stringify({
    type: 'speaking',
    username: ws.username,
    speaking: !!speaking
  });

  channel.members.forEach((info) => {
    try {
      if (info.ws.readyState === 1) {
        info.ws.send(payload);
      }
    } catch (_) {}
  });

  broadcastVoiceMembers(channelName);
}

function removeVoicePeer(ws) {
  const username = ws.username;
  const channelName = ws.channelName;
  if (!username || !channelName) return;

  const channel = voiceChannels.get(channelName);
  if (!channel) return;

  channel.members.delete(username);

  const leavePayload = JSON.stringify({
    type: 'leave',
    username
  });

  channel.members.forEach((info) => {
    try {
      if (info.ws.readyState === 1) {
        info.ws.send(leavePayload);
      }
    } catch (_) {}
  });

  broadcastVoiceMembers(channelName);

  if (channel.members.size === 0) {
    voiceChannels.delete(channelName);
  }

  delete ws.username;
  delete ws.channelName;
}

const textClients = []; // { username, ws }
const onlinePresence = new Map(); // username -> { status, ws }
const voiceChannels = new Map(); // channelName -> { members: Map(username -> { ws, muted }) }
const activeCalls = new Map(); // callId -> { id, from, to, roomId, createdAt, status }

// ---------- AUTH ----------

webApp.post('/register', async (req, res) => {
  const username = sanitizeUsername(req.body?.username);
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  if (!/^[a-z0-9_-]{3,24}$/.test(username)) {
    return res.status(400).json({
      error: 'Логин: 3–24 символа, только буквы, цифры, _ и -'
    });
  }

  if (!isValidEmail(email)) {
    return res.status(400).json({
      error: 'Введите корректную почту'
    });
  }

  if (password.length < 8) {
    return res.status(400).json({
      error: 'Пароль должен быть минимум 8 символов'
    });
  }

  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Введите логин, почту и пароль' });
  }

  if (users[username]) {
    return res.status(400).json({ error: 'Пользователь уже существует' });
  }

  const emailTaken = Object.values(users).some(
    (u) => String(u.email || '').toLowerCase() === email
  );

  if (emailTaken) {
    return res.status(400).json({ error: 'Эта почта уже используется' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const emailCode = generateEmailCode();
  const emailCodeExpiresAt = Date.now() + 10 * 60 * 1000;

  users[username] = {
    username,
    email,
    passwordHash,
    emailVerified: !REQUIRE_EMAIL_VERIFICATION,
    emailCode,
    emailCodeExpiresAt,
    resetToken: null,
    resetTokenExp: 0,
    createdAt: new Date().toISOString()
  };

  ensureUserCollections(username);

  saveUsers();
  saveFriends();

  if (!REQUIRE_EMAIL_VERIFICATION) {
    return res.json({
      ok: true,
      requiresEmailVerification: false,
      username,
      message: 'Регистрация успешна. Подтверждение почты отключено на сервере.'
    });
  }

  let mailResult;
  try {
    mailResult = await sendVerificationEmail(email, username, emailCode);
  } catch (err) {
    console.error('sendVerificationEmail error:', err);
    return res.status(500).json({
      error: 'Не удалось отправить код на почту. Проверь настройки SMTP на сервере.',
      details: err?.message || String(err)
    });
  }

  return res.json({
    ok: true,
    requiresEmailVerification: true,
    username,
    ...buildMailClientPayload(mailResult)
  });
});

webApp.post('/login', async (req, res) => {
  const username = sanitizeUsername(req.body?.username);
  const password = String(req.body?.password || '');

  const user = users[username];
  if (!user) {
    return res.status(400).json({ error: 'Неверный логин или пароль' });
  }

  const ip = req.ip;

  if (!loginAttempts[ip]) {
    loginAttempts[ip] = { count: 0, last: Date.now() };
  }

  if (loginAttempts[ip].count > 5 && Date.now() - loginAttempts[ip].last < 60000) {
    return res.status(429).json({ error: 'Слишком много попыток. Подожди.' });
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    loginAttempts[ip].count++;
    loginAttempts[ip].last = Date.now();
    return res.status(400).json({ error: 'Неверный логин или пароль' });
  }

  loginAttempts[ip] = { count: 0, last: Date.now() };

  if (REQUIRE_EMAIL_VERIFICATION && !user.emailVerified) {
    const emailCode = generateEmailCode();
    user.emailCode = emailCode;
    user.emailCodeExpiresAt = Date.now() + 10 * 60 * 1000;
    saveUsers();

    let mailResult;
    try {
      mailResult = await sendVerificationEmail(user.email, username, emailCode);
    } catch (err) {
      console.error('sendVerificationEmail error:', err);
      return res.status(500).json({
        error: 'Не удалось отправить код подтверждения',
        details: err?.message || String(err)
      });
    }

    return res.status(403).json({
      error: 'Почта не подтверждена',
      requiresEmailVerification: true,
      username,
      ...buildMailClientPayload(mailResult)
    });
  }

  removeExpiredSessions();

  const token = createToken();
  const now = Date.now();

  sessions[token] = {
    sessionId: createSessionId(),
    username,
    deviceName: createDeviceName(req.body?.deviceName),
    createdAt: now,
    lastUsedAt: now,
    expiresAt: now + 1000 * 60 * 60 * 24 * 7
  };

  saveSessions();
  ensureProfile(username);

  return res.json({
    ok: true,
    token,
    username,
    sessionId: sessions[token].sessionId
  });
});

webApp.post('/verify-email', (req, res) => {
  const username = sanitizeUsername(req.body?.username);
  const code = String(req.body?.code || '').trim();

  const user = users[username];
  if (!user) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }

  if (user.emailVerified) {
    return res.json({ ok: true, alreadyVerified: true });
  }

  if (!code) {
    return res.status(400).json({ error: 'Введите код подтверждения' });
  }

  if (!user.emailCode || !user.emailCodeExpiresAt) {
    return res.status(400).json({ error: 'Код не найден. Запроси новый.' });
  }

  if (Date.now() > Number(user.emailCodeExpiresAt)) {
    return res.status(400).json({ error: 'Код истёк. Запроси новый.' });
  }

  if (String(user.emailCode) !== code) {
    return res.status(400).json({ error: 'Неверный код подтверждения' });
  }

  user.emailVerified = true;
  user.emailCode = null;
  user.emailCodeExpiresAt = null;

  saveUsers();

  return res.json({ ok: true });
});

webApp.post('/resend-email-code', async (req, res) => {
  const username = sanitizeUsername(req.body?.username);

  const user = users[username];
  if (!user) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }

  if (user.emailVerified) {
    return res.json({ ok: true, alreadyVerified: true });
  }

  user.emailCode = generateEmailCode();
  user.emailCodeExpiresAt = Date.now() + 10 * 60 * 1000;
  saveUsers();

  let mailResult;
  try {
    mailResult = await sendVerificationEmail(user.email, username, user.emailCode);
  } catch (err) {
    console.error('sendVerificationEmail error:', err);
    return res.status(500).json({
      error: 'Не удалось отправить код повторно',
      details: err?.message || String(err)
    });
  }

  return res.json({
    ok: true,
    ...buildMailClientPayload(mailResult)
  });
});

webApp.post('/forgot-password', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();

  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Введите корректную почту' });
  }

  const user = Object.values(users).find(
    (u) => String(u.email || '').toLowerCase() === email
  );

  if (!user) {
    return res.json({ ok: true });
  }

  const token = crypto.randomBytes(32).toString('hex');
  user.resetToken = token;
  user.resetTokenExp = Date.now() + 60 * 60 * 1000;

  saveUsers();

  try {
    await sendResetPasswordEmail(user.email, user.username, token);
  } catch (err) {
    console.error('sendResetPasswordEmail error:', err);
    return res.status(500).json({ error: 'Не удалось отправить письмо' });
  }

  return res.json({ ok: true });
});

webApp.post('/reset-password', async (req, res) => {
  const token = String(req.body?.token || '').trim();
  const password = String(req.body?.password || '');

  if (!token || password.length < 8) {
    return res.status(400).json({ error: 'Пароль должен быть минимум 8 символов' });
  }

  const user = Object.values(users).find((u) => u.resetToken === token);

  if (!user) {
    return res.status(400).json({ error: 'Ссылка недействительна' });
  }

  if (!user.resetTokenExp || Date.now() > Number(user.resetTokenExp)) {
    return res.status(400).json({ error: 'Ссылка истекла' });
  }

  user.passwordHash = await bcrypt.hash(password, 10);
  user.resetToken = null;
  user.resetTokenExp = 0;

  saveUsers();

  return res.json({ ok: true });
});

webApp.post('/restore-session', (req, res) => {
  const token = String(req.body?.token || '');
  removeExpiredSessions();

  const session = getSessionByToken(token);
  if (!session) {
    return res.status(401).json({ error: 'Сессия не найдена' });
  }

  session.lastUsedAt = Date.now();
  saveSessions();

  return res.json({
    ok: true,
    username: session.username,
    sessionId: session.sessionId,
    deviceName: session.deviceName
  });
});

webApp.post('/logout', (req, res) => {
  const token = String(req.body?.token || '');
  const username = sanitizeUsername(req.body?.username);

  if (token && sessions[token]) {
    delete sessions[token];
    saveSessions();
  }

  if (username && onlinePresence.has(username)) {
    onlinePresence.delete(username);
    broadcastOnlineUsers();
  }

  return res.json({ ok: true });
});

webApp.post('/sessions', (req, res) => {
  const token = String(req.body?.token || '');
  removeExpiredSessions();

  const session = getSessionByToken(token);
  if (!session) {
    return res.status(401).json({ error: 'Сессия не найдена' });
  }

  session.lastUsedAt = Date.now();
  saveSessions();

  return res.json({
    ok: true,
    sessions: getUserSessions(session.username).map((s) => ({
      sessionId: s.sessionId,
      deviceName: s.deviceName,
      createdAt: s.createdAt,
      lastUsedAt: s.lastUsedAt,
      expiresAt: s.expiresAt,
      current: s.token === token
    }))
  });
});

webApp.post('/logout-session', (req, res) => {
  const token = String(req.body?.token || '');
  const sessionId = String(req.body?.sessionId || '');
  removeExpiredSessions();

  const currentSession = getSessionByToken(token);
  if (!currentSession) {
    return res.status(401).json({ error: 'Сессия не найдена' });
  }

  const targetEntry = Object.entries(sessions).find(([, s]) =>
    s &&
    s.username === currentSession.username &&
    s.sessionId === sessionId
  );

  if (!targetEntry) {
    return res.status(404).json({ error: 'Устройство не найдено' });
  }

  const [targetToken] = targetEntry;
  const isCurrent = targetToken === token;

  delete sessions[targetToken];
  saveSessions();

  return res.json({
    ok: true,
    currentLoggedOut: isCurrent
  });
});

webApp.post('/logout-all-sessions', (req, res) => {
  const token = String(req.body?.token || '');
  removeExpiredSessions();

  const currentSession = getSessionByToken(token);
  if (!currentSession) {
    return res.status(401).json({ error: 'Сессия не найдена' });
  }

  Object.keys(sessions).forEach((sessionToken) => {
    const s = sessions[sessionToken];
    if (s && s.username === currentSession.username) {
      delete sessions[sessionToken];
    }
  });

  saveSessions();

  return res.json({ ok: true });
});

// ---------- PROFILES ----------

webApp.get('/profile/:username', (req, res) => {
  const username = sanitizeUsername(req.params.username);
  return res.json(ensureProfile(username));
});

webApp.post('/profile', (req, res) => {
  const username = sanitizeUsername(req.body?.username);
  const bio = typeof req.body?.bio === 'string' ? req.body.bio.slice(0, 280) : '';
  const avatar = typeof req.body?.avatar === 'string' ? req.body.avatar.slice(0, 2_000_000) : '';
  const status = req.body?.status;

  if (!username) {
    return res.status(400).json({ error: 'Нет username' });
  }

  const profile = ensureProfile(username);
  profile.bio = bio;
  profile.avatar = avatar;

  if (isValidStatus(status)) {
    profile.status = status;
  }

  profiles[username] = profile;
  saveProfiles();

  if (onlinePresence.has(username)) {
    onlinePresence.get(username).status = profile.status;
  }

  broadcastProfileUpdated(profile);

  return res.json({ ok: true, profile });
});

webApp.post('/status', (req, res) => {
  const username = sanitizeUsername(req.body?.username);
  const status = req.body?.status;

  if (!username || !isValidStatus(status)) {
    return res.status(400).json({ error: 'Неверный статус' });
  }

  const profile = ensureProfile(username);
  profile.status = status;
  profiles[username] = profile;
  saveProfiles();

  if (onlinePresence.has(username)) {
    onlinePresence.get(username).status = status;
  }

  broadcastStatusUpdated(username, status);

  return res.json({ ok: true });
});

// ---------- FRIENDS ----------

webApp.get('/friends/:username', (req, res) => {
  const username = sanitizeUsername(req.params.username);
  ensureUserCollections(username);
  return res.json(friends[username] || []);
});

webApp.post('/send-friend-request', (req, res) => {
  const from = sanitizeUsername(req.body?.from);
  const to = sanitizeUsername(req.body?.to);

  if (!from || !to) {
    return res.status(400).json({ error: 'Неверные данные' });
  }

  if (!users[to]) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }

  if (from === to) {
    return res.status(400).json({ error: 'Нельзя добавить самого себя' });
  }

  ensureUserCollections(from);
  ensureUserCollections(to);

  if (areFriends(from, to)) {
    return res.status(400).json({ error: 'Вы уже друзья' });
  }

  const exists = friendRequests.find(
    (r) =>
      r.status === 'pending' &&
      (
        (r.from === from && r.to === to) ||
        (r.from === to && r.to === from)
      )
  );

  if (exists) {
    return res.status(400).json({ error: 'Заявка уже существует' });
  }

  const request = {
    id: createId(),
    from,
    to,
    status: 'pending',
    createdAt: new Date().toISOString()
  };

  friendRequests.push(request);
  saveFriendRequests();

  return res.json({ ok: true, request });
});

webApp.get('/friend-requests/:username', (req, res) => {
  const username = sanitizeUsername(req.params.username);

  const incoming = friendRequests.filter(
    (r) => r.to === username && r.status === 'pending'
  );

  const outgoing = friendRequests.filter(
    (r) => r.from === username && r.status === 'pending'
  );

  return res.json({ incoming, outgoing });
});

webApp.post('/accept-friend-request', (req, res) => {
  const requestId = String(req.body?.requestId || '');
  const username = sanitizeUsername(req.body?.username);

  const request = friendRequests.find((r) => r.id === requestId);
  if (!request || request.to !== username || request.status !== 'pending') {
    return res.status(400).json({ error: 'Заявка не найдена' });
  }

  request.status = 'accepted';

  ensureUserCollections(request.from);
  ensureUserCollections(request.to);

  if (!friends[request.from].includes(request.to)) {
    friends[request.from].push(request.to);
  }

  if (!friends[request.to].includes(request.from)) {
    friends[request.to].push(request.from);
  }

  saveFriendRequests();
  saveFriends();

  sendUnreadSnapshot(request.from);
  sendUnreadSnapshot(request.to);

  return res.json({ ok: true });
});

webApp.post('/decline-friend-request', (req, res) => {
  const requestId = String(req.body?.requestId || '');
  const username = sanitizeUsername(req.body?.username);

  const request = friendRequests.find((r) => r.id === requestId);
  if (!request || request.to !== username || request.status !== 'pending') {
    return res.status(400).json({ error: 'Заявка не найдена' });
  }

  request.status = 'declined';
  saveFriendRequests();

  return res.json({ ok: true });
});

webApp.post('/cancel-friend-request', (req, res) => {
  const requestId = String(req.body?.requestId || '');
  const username = sanitizeUsername(req.body?.username);

  const request = friendRequests.find((r) => r.id === requestId);
  if (!request || request.from !== username || request.status !== 'pending') {
    return res.status(400).json({ error: 'Заявка не найдена' });
  }

  request.status = 'cancelled';
  saveFriendRequests();

  return res.json({ ok: true });
});

webApp.post('/remove-friend', (req, res) => {
  const username = sanitizeUsername(req.body?.username);
  const friend = sanitizeUsername(req.body?.friend);

  ensureUserCollections(username);
  ensureUserCollections(friend);

  friends[username] = (friends[username] || []).filter((u) => u !== friend);
  friends[friend] = (friends[friend] || []).filter((u) => u !== username);

  saveFriends();

  return res.json({ ok: true });
});

// ---------- GLOBAL CHAT ----------

webApp.get('/global-messages', (_req, res) => {
  return res.json(globalMessages);
});

// ---------- DM ----------

webApp.get('/dm/:user/:friend', (req, res) => {
  const user = sanitizeUsername(req.params.user);
  const friend = sanitizeUsername(req.params.friend);

  const messages = dmMessages.filter(
    (m) =>
      (m.from === user && m.to === friend) ||
      (m.from === friend && m.to === user)
  );

  return res.json(messages);
});

webApp.post('/dm', (req, res) => {
  const from = sanitizeUsername(req.body?.from);
  const to = sanitizeUsername(req.body?.to);
  const text = String(req.body?.text || '').trim();

  if (!from || !to || !text) {
    return res.status(400).json({ error: 'Неверные данные' });
  }

  if (!areFriends(from, to)) {
    return res.status(403).json({ error: 'Вы не друзья' });
  }

  const replyTo = req.body?.replyTo || null;

  const message = {
    id: createId(),
    from,
    to,
    text: text.slice(0, 4000),
    createdAt: new Date().toISOString(),
    read: false,
    replyTo: replyTo ? {
      id: replyTo.id,
      from: replyTo.from,
      text: String(replyTo.text || '').slice(0, 200)
    } : null
  };

  dmMessages.push(message);
  saveDmMessages();

  sendDmToParticipants(message);

  return res.json({ ok: true, message });
});

webApp.post('/dm-read', (req, res) => {
  const user = sanitizeUsername(req.body?.user);
  const friend = sanitizeUsername(req.body?.friend);

  let changed = false;

  dmMessages.forEach((m) => {
    if (m.to === user && m.from === friend && !m.read) {
      m.read = true;
      changed = true;
    }
  });

  if (changed) {
    saveDmMessages();
  }

  sendUnreadSnapshot(user);
  sendUnreadSnapshot(friend);

  return res.json({ ok: true });
});

webApp.post('/dm-delete', (req, res) => {
  const id = String(req.body?.id || '');
  const username = sanitizeUsername(req.body?.username);

  const idx = dmMessages.findIndex((m) => m.id === id);
  if (idx === -1) {
    return res.status(404).json({ error: 'Сообщение не найдено' });
  }

  const message = dmMessages[idx];
  if (message.from !== username) {
    return res.status(403).json({ error: 'Можно удалить только своё сообщение' });
  }

  dmMessages.splice(idx, 1);
  saveDmMessages();
  sendDmDeleteToParticipants(message);

  return res.json({ ok: true });
});

webApp.post('/dm-edit', (req, res) => {
  const id = String(req.body?.id || '');
  const username = sanitizeUsername(req.body?.username);
  const newText = String(req.body?.text || '').trim();

  if (!id || !username || !newText) {
    return res.status(400).json({ error: 'Неверные данные' });
  }

  const message = dmMessages.find((m) => m.id === id);

  if (!message) {
    return res.status(404).json({ error: 'Сообщение не найдено' });
  }

  if (message.from !== username) {
    return res.status(403).json({ error: 'Можно редактировать только своё сообщение' });
  }

  message.text = newText.slice(0, 4000);
  message.edited = true;

  saveDmMessages();

  // уведомляем клиентов
  const payload = JSON.stringify({
    type: 'dm-edit',
    message
  });

  textClients.forEach((client) => {
    try {
      if (
        client.ws.readyState === 1 &&
        (client.username === message.from || client.username === message.to)
      ) {
        client.ws.send(payload);
      }
    } catch (_) {}
  });

  return res.json({ ok: true, message });
});

// ---------- HTTP START ----------

const httpServer = webApp.listen(CONFIG.HTTP_PORT, '0.0.0.0', () => {
  const radminHost = pickBestServerIp();
  const vpn = getVpnNetworkInfo();

  console.log('');
  console.log('========== MiniDiscord / Radmin VPN ==========');
  console.log(`HTTP:  http://${radminHost}:${CONFIG.HTTP_PORT}`);
  console.log(`Voice: ws://${radminHost}:${CONFIG.VOICE_PORT}`);
  if (vpn.hasVpn) {
    console.log('VPN:   обнаружен (' + vpn.vpnAdapters.map((a) => `${a.name}=${a.address}`).join(', ') + ')');
  } else {
    console.log('VPN:   Radmin/Hamachi не найден — включи VPN на этом ПК');
  }
  console.log('Клиентам в config.js укажи SERVER_HOST=' + radminHost);
  console.log('==============================================');
  console.log('');
  console.log(`Data dir: ${DATA_DIR}`);

  verifyMailTransport().catch((err) => {
    console.error('verifyMailTransport error:', err?.message || err);
  });

  if (!electronApp) {
    startDiscoveryService(() => ({
      host: radminHost,
      httpPort: CONFIG.HTTP_PORT,
      voicePort: CONFIG.VOICE_PORT
    }));
  }
});

// ---------- TEXT WS ----------

const wssText = new WebSocketServer({ server: httpServer });

wssText.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch (_) {
      return;
    }

    if (data.type === 'join') {
      const username = sanitizeUsername(data.username);
      if (!username) return;

      ensureUserCollections(username);

      const existing = textClients.find((c) => c.username === username);
      if (!existing) {
        textClients.push({ username, ws });
      } else {
        existing.ws = ws;
      }

      ws.username = username;

      onlinePresence.set(username, {
        status: profiles[username]?.status || 'online',
        ws
      });

      try {
        ws.send(JSON.stringify({
          type: 'global-history',
          messages: globalMessages
        }));
      } catch (_) {}

      sendUnreadSnapshot(username);
      broadcastOnlineUsers();
      return;
    }

    if (data.type === 'global-message') {
      const username = sanitizeUsername(data.username);
      const text = String(data.text || '').trim();
      if (!username || !text) return;

      ensureProfile(username);

      const message = {
        id: createId(),
        username,
        text: text.slice(0, 4000),
        createdAt: new Date().toISOString()
      };

      globalMessages.push(message);

      if (globalMessages.length > 1000) {
        globalMessages = globalMessages.slice(-1000);
      }

      saveGlobalMessages();
      broadcastGlobalMessage(message);
      return;
    }

    if (data.type === 'dm-typing') {
      const from = sanitizeUsername(data.from);
      const to = sanitizeUsername(data.to);
      if (!from || !to) return;
      sendTyping(from, to, !!data.isTyping);
      return;
    }
	
	if (data.type === 'call-start') {
	  const from = sanitizeUsername(data.from);
	  const to = sanitizeUsername(data.to);

	  if (!from || !to || from === to) return;
	  if (!areFriends(from, to)) return;

	  const existing = Array.from(activeCalls.values()).find((call) =>
	    call &&
	    call.status === 'ringing' &&
	    (
	      (call.from === from && call.to === to) ||
	      (call.from === to && call.to === from)
	    )
	  );

	  if (existing) {
	    sendTextEventToUser(from, {
	      type: 'call-error',
	      to,
	      error: 'Звонок уже активен'
	    });
	    return;
	  }

	  const targetClient = getTextClientByUsername(to);
	  if (!targetClient) {
	    sendTextEventToUser(from, {
	      type: 'call-error',
	      to,
	      error: 'Пользователь не в сети'
	    });
	    return;
	  }

	  const callId = createId();
	  const roomId = createPrivateCallRoom(from, to);

	  activeCalls.set(callId, {
	    id: callId,
	    from,
	    to,
	    roomId,
	    createdAt: Date.now(),
	    status: 'ringing'
	  });

	  sendTextEventToUser(to, {
	    type: 'incoming-call',
	    callId,
	    from,
	    roomId
	  });

	  sendTextEventToUser(from, {
	    type: 'outgoing-call',
	    callId,
	    to,
	    roomId
	  });

	  setTimeout(() => {
	    const call = activeCalls.get(callId);
	    if (!call || call.status !== 'ringing') return;

	    sendTextEventToUser(call.from, {
	      type: 'call-timeout',
	      callId,
	      to: call.to
	    });

	    sendTextEventToUser(call.to, {
	      type: 'call-missed',
	      callId,
	      from: call.from
	    });

	    cleanupCall(callId);
	  }, 30000);

	  return;
	}

	if (data.type === 'call-accept') {
	  const callId = String(data.callId || '');
	  const username = sanitizeUsername(data.username);

	  const call = activeCalls.get(callId);
	  if (!call || call.status !== 'ringing') return;
	  if (call.to !== username) return;

	  call.status = 'accepted';

	  sendTextEventToUser(call.from, {
	    type: 'call-accepted',
	    callId,
	    by: username,
	    roomId: call.roomId
	  });

	  sendTextEventToUser(call.to, {
	    type: 'call-accepted',
	    callId,
	    by: username,
	    roomId: call.roomId
	  });

	  cleanupCall(callId);
	  return;
	}

	if (data.type === 'call-decline') {
	  const callId = String(data.callId || '');
	  const username = sanitizeUsername(data.username);

	  const call = activeCalls.get(callId);
	  if (!call || call.status !== 'ringing') return;
	  if (call.to !== username) return;

	  call.status = 'declined';

	  sendTextEventToUser(call.from, {
	    type: 'call-declined',
	    callId,
	    by: username
	  });

	  cleanupCall(callId);
	  return;
	}

	if (data.type === 'call-cancel') {
	  const callId = String(data.callId || '');
	  const username = sanitizeUsername(data.username);

	  const call = activeCalls.get(callId);
	  if (!call) return;
	  if (call.from !== username) return;

	  sendTextEventToUser(call.to, {
	    type: 'call-cancelled',
	    callId,
	    by: username
	  });

	  cleanupCall(callId);
	  return;
	}

    if (data.type === 'status-update') {
      const username = sanitizeUsername(data.username);
      const status = data.status;

      if (username && isValidStatus(status)) {
        const profile = ensureProfile(username);
        profile.status = status;
        profiles[username] = profile;
        saveProfiles();

        if (onlinePresence.has(username)) {
          onlinePresence.get(username).status = status;
        }

        broadcastStatusUpdated(username, status);
      }
      return;
    }

    if (data.type === 'profile-updated') {
      const profile = data.profile;

      if (profile && profile.username) {
        profiles[profile.username] = {
          ...ensureProfile(profile.username),
          ...profile
        };

        saveProfiles();

        if (onlinePresence.has(profile.username)) {
          onlinePresence.get(profile.username).status =
            profiles[profile.username].status || 'online';
        }

        broadcastProfileUpdated(profiles[profile.username]);
      }
    }
  });

  ws.on('close', () => {
    removeTextClient(ws);

    if (ws.username) {
      const closedUser = ws.username;

      Array.from(activeCalls.entries()).forEach(([callId, call]) => {
        if (!call) return;
  
        if (call.from === closedUser || call.to === closedUser) {
          const otherUser = call.from === closedUser ? call.to : call.from;

          sendTextEventToUser(otherUser, {
            type: 'call-cancelled',
            callId,
            by: closedUser
          });

          cleanupCall(callId);
        }
      });

      onlinePresence.delete(ws.username);
      broadcastOnlineUsers();
    }
  });
});

// ---------- VOICE WS ----------

const voiceHttpServer = http.createServer();
voiceHttpServer.listen(CONFIG.VOICE_PORT, '0.0.0.0', () => {
  console.log(`Voice WS server started on ws://0.0.0.0:${CONFIG.VOICE_PORT}`);
});

const wssVoice = new WebSocketServer({ server: voiceHttpServer });

wssVoice.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch (_) {
      return;
    }

    if (data.type === 'join-channel') {
      const username = sanitizeUsername(data.username);
      const channelName = String(data.channel || 'General');

      if (!username) return;

      ensureProfile(username);

      if (!voiceChannels.has(channelName)) {
        voiceChannels.set(channelName, {
          members: new Map()
        });
      }

      const channel = voiceChannels.get(channelName);
      const existingPeers = Array.from(channel.members.keys()).filter((u) => u !== username);

      channel.members.set(username, {
        ws,
        muted: false,
        speaking: false
      });

      ws.username = username;
      ws.channelName = channelName;

      try {
        ws.send(JSON.stringify({
          type: 'channel-members',
          members: existingPeers
        }));
      } catch (_) {}

      const notifyPayload = JSON.stringify({
        type: 'new-peer',
        peerId: username
      });

      channel.members.forEach((info, memberName) => {
        if (memberName !== username) {
          try {
            if (info.ws.readyState === 1) {
              info.ws.send(notifyPayload);
            }
          } catch (_) {}
        }
      });

      broadcastVoiceMembers(channelName);
      return;
    }

    if (data.type === 'voice-mute-state') {
      const channelName = ws.channelName;
      const username = ws.username;
      if (!channelName || !username) return;

      const channel = voiceChannels.get(channelName);
      if (!channel || !channel.members.has(username)) return;

      channel.members.get(username).muted = !!data.muted;
      broadcastVoiceMembers(channelName);
      return;
    }

    if (data.type === 'speaking') {
      broadcastSpeaking(ws, !!data.speaking);
      return;
    }

    if (data.type === 'leave-channel') {
      removeVoicePeer(ws);
      return;
    }

    if (data.type === 'offer' || data.type === 'answer' || data.type === 'ice-candidate') {
      const to = sanitizeUsername(data.to);
      const channelName = ws.channelName;
      if (!to || !channelName) return;

      const channel = voiceChannels.get(channelName);
      if (!channel) return;

      const target = channel.members.get(to);
      if (!target || target.ws.readyState !== 1) return;

      const payload = {
        type: data.type,
        from: ws.username
      };

      if (data.type === 'offer') payload.offer = data.offer;
      if (data.type === 'answer') payload.answer = data.answer;
      if (data.type === 'ice-candidate') payload.candidate = data.candidate;

      try {
        target.ws.send(JSON.stringify(payload));
      } catch (_) {}
    }
  });

  ws.on('close', () => {
    removeVoicePeer(ws);
  });
});

module.exports = {
  app: webApp,
  httpServer,
  wssText,
  wssVoice
};