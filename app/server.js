const express = require('express');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');
const WebSocket = require('ws');

const appExpress = express();
appExpress.use(express.json());

const DB_FILE = path.join(app.getPath('userData'), 'db.json');
const HTTP_PORT = 3000;
const VOICE_PORT = 4001;
const HTTP_HOST = '0.0.0.0';

function defaultDb() {
  return {
    users: [],
    globalMessages: [],
    friends: {},
    dms: [],
    dmReadState: {},
    sessions: {},
    dmTyping: {},
    friendRequests: []
  };
}

function ensureDbShape(raw) {
  const db = raw && typeof raw === 'object' ? raw : {};
  if (!Array.isArray(db.users)) db.users = [];
  if (!Array.isArray(db.globalMessages)) db.globalMessages = [];
  if (!db.friends || typeof db.friends !== 'object' || Array.isArray(db.friends)) db.friends = {};
  if (!Array.isArray(db.dms)) db.dms = [];
  if (!db.dmReadState || typeof db.dmReadState !== 'object' || Array.isArray(db.dmReadState)) db.dmReadState = {};
  if (!db.sessions || typeof db.sessions !== 'object' || Array.isArray(db.sessions)) db.sessions = {};
  if (!db.dmTyping || typeof db.dmTyping !== 'object' || Array.isArray(db.dmTyping)) db.dmTyping = {};
  if (!Array.isArray(db.friendRequests)) db.friendRequests = [];
  return db;
}

function loadDB() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      const db = defaultDb();
      fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
      return db;
    }
    const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    const db = ensureDbShape(raw);
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
    return db;
  } catch (err) {
    console.error('DB load error:', err);
    const db = defaultDb();
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
    return db;
  }
}

let db = loadDB();

function saveDB() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}

function dmKey(owner, friend) {
  return `${owner}::${friend}`;
}

function userExists(username) {
  return db.users.some((u) => u.username === username);
}

function areFriends(a, b) {
  return (db.friends[a] || []).includes(b) && (db.friends[b] || []).includes(a);
}

function cleanupOldTyping() {
  const now = Date.now();
  for (const [key, state] of Object.entries(db.dmTyping)) {
    if (!state || now - state.updatedAt > 10000) {
      delete db.dmTyping[key];
    }
  }
}

function removeFriendLink(a, b) {
  if (!db.friends[a]) db.friends[a] = [];
  if (!db.friends[b]) db.friends[b] = [];

  db.friends[a] = db.friends[a].filter((name) => name !== b);
  db.friends[b] = db.friends[b].filter((name) => name !== a);
}

setInterval(() => {
  cleanupOldTyping();
}, 5000);

// ---------- AUTH ----------

appExpress.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Введите логин и пароль' });
    }
    if (db.users.some((u) => u.username === username)) {
      return res.status(400).json({ error: 'Пользователь уже существует' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    db.users.push({ username, passwordHash });

    if (!db.friends[username]) db.friends[username] = [];

    saveDB();
    res.json({ ok: true });
  } catch (err) {
    console.error('/register error:', err);
    res.status(500).json({ error: 'server error' });
  }
});

appExpress.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    const user = db.users.find((u) => u.username === username);

    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Неверный пароль' });
    }

    const token = crypto.randomUUID();
    db.sessions[token] = { username, createdAt: Date.now() };
    saveDB();

    res.json({ ok: true, username, token });
  } catch (err) {
    console.error('/login error:', err);
    res.status(500).json({ error: 'server error' });
  }
});

appExpress.post('/restore-session', (req, res) => {
  try {
    const { token } = req.body || {};
    if (!token || !db.sessions[token]) {
      return res.status(401).json({ error: 'Сессия не найдена' });
    }

    res.json({ ok: true, username: db.sessions[token].username });
  } catch (err) {
    console.error('/restore-session error:', err);
    res.status(500).json({ error: 'server error' });
  }
});

appExpress.post('/logout', (req, res) => {
  try {
    const { token } = req.body || {};
    if (token && db.sessions[token]) {
      delete db.sessions[token];
      saveDB();
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('/logout error:', err);
    res.status(500).json({ error: 'server error' });
  }
});

// ---------- FRIENDS ----------

appExpress.get('/friends/:user', (req, res) => {
  try {
    const username = req.params.user;
    res.json((db.friends[username] || []).sort());
  } catch (err) {
    console.error('/friends error:', err);
    res.status(500).json({ error: 'server error' });
  }
});

appExpress.get('/friend-requests/:user', (req, res) => {
  try {
    const username = req.params.user;

    const incoming = db.friendRequests
      .filter((r) => r.to === username && r.status === 'pending')
      .sort((a, b) => b.createdAt - a.createdAt);

    const outgoing = db.friendRequests
      .filter((r) => r.from === username && r.status === 'pending')
      .sort((a, b) => b.createdAt - a.createdAt);

    res.json({ incoming, outgoing });
  } catch (err) {
    console.error('/friend-requests error:', err);
    res.status(500).json({ error: 'server error' });
  }
});

appExpress.post('/send-friend-request', (req, res) => {
  try {
    const { from, to } = req.body || {};

    if (!from || !to) {
      return res.status(400).json({ error: 'Укажи оба ника' });
    }
    if (from === to) {
      return res.status(400).json({ error: 'Нельзя добавить себя' });
    }
    if (!userExists(from) || !userExists(to)) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    if (areFriends(from, to)) {
      return res.status(400).json({ error: 'Вы уже друзья' });
    }

    const alreadyPending = db.friendRequests.some(
      (r) =>
        r.status === 'pending' &&
        ((r.from === from && r.to === to) || (r.from === to && r.to === from))
    );

    if (alreadyPending) {
      return res.status(400).json({ error: 'Заявка уже существует' });
    }

    db.friendRequests.push({
      id: crypto.randomUUID(),
      from,
      to,
      status: 'pending',
      createdAt: Date.now()
    });

    saveDB();
    res.json({ ok: true });
  } catch (err) {
    console.error('/send-friend-request error:', err);
    res.status(500).json({ error: 'server error' });
  }
});

appExpress.post('/accept-friend-request', (req, res) => {
  try {
    const { requestId, username } = req.body || {};
    const request = db.friendRequests.find((r) => r.id === requestId);

    if (!request) {
      return res.status(404).json({ error: 'Заявка не найдена' });
    }
    if (request.to !== username) {
      return res.status(403).json({ error: 'Это не твоя заявка' });
    }
    if (request.status !== 'pending') {
      return res.status(400).json({ error: 'Заявка уже обработана' });
    }

    request.status = 'accepted';
    request.updatedAt = Date.now();

    if (!db.friends[request.from]) db.friends[request.from] = [];
    if (!db.friends[request.to]) db.friends[request.to] = [];

    if (!db.friends[request.from].includes(request.to)) {
      db.friends[request.from].push(request.to);
    }
    if (!db.friends[request.to].includes(request.from)) {
      db.friends[request.to].push(request.from);
    }

    saveDB();
    res.json({ ok: true });
  } catch (err) {
    console.error('/accept-friend-request error:', err);
    res.status(500).json({ error: 'server error' });
  }
});

appExpress.post('/decline-friend-request', (req, res) => {
  try {
    const { requestId, username } = req.body || {};
    const request = db.friendRequests.find((r) => r.id === requestId);

    if (!request) {
      return res.status(404).json({ error: 'Заявка не найдена' });
    }
    if (request.to !== username) {
      return res.status(403).json({ error: 'Это не твоя заявка' });
    }
    if (request.status !== 'pending') {
      return res.status(400).json({ error: 'Заявка уже обработана' });
    }

    request.status = 'declined';
    request.updatedAt = Date.now();

    saveDB();
    res.json({ ok: true });
  } catch (err) {
    console.error('/decline-friend-request error:', err);
    res.status(500).json({ error: 'server error' });
  }
});

appExpress.post('/cancel-friend-request', (req, res) => {
  try {
    const { requestId, username } = req.body || {};
    const request = db.friendRequests.find((r) => r.id === requestId);

    if (!request) {
      return res.status(404).json({ error: 'Заявка не найдена' });
    }
    if (request.from !== username) {
      return res.status(403).json({ error: 'Можно отменить только свою заявку' });
    }
    if (request.status !== 'pending') {
      return res.status(400).json({ error: 'Заявка уже обработана' });
    }

    request.status = 'cancelled';
    request.updatedAt = Date.now();

    saveDB();
    res.json({ ok: true });
  } catch (err) {
    console.error('/cancel-friend-request error:', err);
    res.status(500).json({ error: 'server error' });
  }
});

appExpress.post('/remove-friend', (req, res) => {
  try {
    const { username, friend } = req.body || {};

    if (!username || !friend) {
      return res.status(400).json({ error: 'Нет username/friend' });
    }
    if (!userExists(username) || !userExists(friend)) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    if (!areFriends(username, friend)) {
      return res.status(400).json({ error: 'Вы не друзья' });
    }

    removeFriendLink(username, friend);

    delete db.dmReadState[dmKey(username, friend)];
    delete db.dmReadState[dmKey(friend, username)];
    delete db.dmTyping[`${username}::${friend}`];
    delete db.dmTyping[`${friend}::${username}`];

    saveDB();
    res.json({ ok: true });
  } catch (err) {
    console.error('/remove-friend error:', err);
    res.status(500).json({ error: 'server error' });
  }
});

// ---------- DM ----------

appExpress.get('/dm/:u1/:u2', (req, res) => {
  try {
    const { u1, u2 } = req.params;
    const msgs = db.dms
      .filter((m) => (m.from === u1 && m.to === u2) || (m.from === u2 && m.to === u1))
      .sort((a, b) => a.createdAt - b.createdAt);

    res.json(msgs);
  } catch (err) {
    console.error('/dm GET error:', err);
    res.status(500).json({ error: 'server error' });
  }
});

appExpress.post('/dm', (req, res) => {
  try {
    const { from, to, text } = req.body || {};

    if (!from || !to || !text) {
      return res.status(400).json({ error: 'Пустое сообщение' });
    }
    if (!areFriends(from, to)) {
      return res.status(403).json({ error: 'DM доступны только друзьям' });
    }

    db.dms.push({
      id: crypto.randomUUID(),
      from,
      to,
      text,
      createdAt: Date.now()
    });

    saveDB();
    res.json({ ok: true });
  } catch (err) {
    console.error('/dm POST error:', err);
    res.status(500).json({ error: 'server error' });
  }
});

appExpress.post('/dm-delete', (req, res) => {
  try {
    const { id, username } = req.body || {};
    const msg = db.dms.find((m) => m.id === id);

    if (!msg) {
      return res.status(404).json({ error: 'Сообщение не найдено' });
    }
    if (msg.from !== username) {
      return res.status(403).json({ error: 'Можно удалять только свои сообщения' });
    }

    db.dms = db.dms.filter((m) => m.id !== id);
    saveDB();

    res.json({ ok: true });
  } catch (err) {
    console.error('/dm-delete error:', err);
    res.status(500).json({ error: 'server error' });
  }
});

appExpress.get('/dm-unread/:user', (req, res) => {
  try {
    const user = req.params.user;
    const result = {};
    const friends = db.friends[user] || [];

    for (const friend of friends) {
      const key = dmKey(user, friend);
      const lastRead = db.dmReadState[key] || 0;

      result[friend] = db.dms.filter(
        (m) => m.from === friend && m.to === user && m.createdAt > lastRead
      ).length;
    }

    res.json(result);
  } catch (err) {
    console.error('/dm-unread error:', err);
    res.status(500).json({ error: 'server error' });
  }
});

appExpress.post('/dm-read', (req, res) => {
  try {
    const { user, friend } = req.body || {};
    if (!user || !friend) {
      return res.status(400).json({ error: 'Нет user/friend' });
    }

    db.dmReadState[dmKey(user, friend)] = Date.now();
    saveDB();

    res.json({ ok: true });
  } catch (err) {
    console.error('/dm-read error:', err);
    res.status(500).json({ error: 'server error' });
  }
});

appExpress.post('/dm-typing', (req, res) => {
  try {
    const { from, to, isTyping } = req.body || {};

    if (!from || !to) {
      return res.status(400).json({ error: 'Нет from/to' });
    }

    const key = `${from}::${to}`;
    db.dmTyping[key] = {
      from,
      to,
      isTyping: !!isTyping,
      updatedAt: Date.now()
    };

    saveDB();
    res.json({ ok: true });
  } catch (err) {
    console.error('/dm-typing POST error:', err);
    res.status(500).json({ error: 'server error' });
  }
});

appExpress.get('/dm-typing/:from/:to', (req, res) => {
  try {
    const { from, to } = req.params;
    const key = `${from}::${to}`;
    const state = db.dmTyping[key];

    if (!state) {
      return res.json({ isTyping: false });
    }

    const fresh = Date.now() - state.updatedAt < 2500;
    res.json({ isTyping: fresh && !!state.isTyping });
  } catch (err) {
    console.error('/dm-typing GET error:', err);
    res.status(500).json({ error: 'server error' });
  }
});

// ---------- HTTP ----------

const httpServer = appExpress.listen(HTTP_PORT, HTTP_HOST, () => {
  console.log(`HTTP server running on ${HTTP_HOST}:${HTTP_PORT}`);
});

// ---------- GLOBAL CHAT + ONLINE ----------

const wssText = new WebSocket.Server({ server: httpServer });
const onlineCounts = new Map();
const textSocketToUser = new Map();

function broadcastText(payload) {
  const msg = JSON.stringify(payload);
  for (const client of wssText.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

function getOnlineUsers() {
  return Array.from(onlineCounts.entries())
    .filter(([, count]) => count > 0)
    .map(([username]) => username)
    .sort();
}

function broadcastOnline() {
  broadcastText({
    type: 'online-users',
    users: getOnlineUsers()
  });
}

wssText.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'global-history', messages: db.globalMessages }));

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw.toString());

      if (data.type === 'join' && data.username) {
        const prevUser = textSocketToUser.get(ws);
        if (prevUser && onlineCounts.has(prevUser)) {
          const next = Math.max(0, (onlineCounts.get(prevUser) || 1) - 1);
          if (next === 0) onlineCounts.delete(prevUser);
          else onlineCounts.set(prevUser, next);
        }

        textSocketToUser.set(ws, data.username);
        onlineCounts.set(data.username, (onlineCounts.get(data.username) || 0) + 1);
        broadcastOnline();
        return;
      }

      if (data.type === 'global-message' && data.username && data.text) {
        const message = {
          id: crypto.randomUUID(),
          username: data.username,
          text: data.text,
          createdAt: Date.now()
        };

        db.globalMessages.push(message);
        saveDB();

        broadcastText({ type: 'global-message', message });
      }
    } catch (err) {
      console.error('Text WS error:', err);
    }
  });

  ws.on('close', () => {
    const username = textSocketToUser.get(ws);
    if (username) {
      const next = Math.max(0, (onlineCounts.get(username) || 1) - 1);
      if (next === 0) onlineCounts.delete(username);
      else onlineCounts.set(username, next);

      textSocketToUser.delete(ws);
      broadcastOnline();
    }
  });
});

// ---------- VOICE SIGNALING ----------

const wssVoice = new WebSocket.Server({ host: HTTP_HOST, port: VOICE_PORT });
const voiceChannels = {};

function ensureVoiceChannel(channelName) {
  if (!voiceChannels[channelName]) {
    voiceChannels[channelName] = {};
  }
  return voiceChannels[channelName];
}

function voiceMembers(channelName) {
  const channel = voiceChannels[channelName] || {};
  return Object.entries(channel)
    .map(([name, state]) => ({
      username: name,
      muted: !!state.muted
    }))
    .sort((a, b) => a.username.localeCompare(b.username));
}

function broadcastVoiceRoster(channelName) {
  const channel = voiceChannels[channelName] || {};
  const members = voiceMembers(channelName);

  for (const state of Object.values(channel)) {
    if (state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify({ type: 'voice-members', members }));
    }
  }
}

wssVoice.on('connection', (ws) => {
  let username = null;
  let currentChannel = null;

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw.toString());

      if (data.type === 'join-channel') {
        username = data.username;
        currentChannel = data.channel || 'General';

        const channel = ensureVoiceChannel(currentChannel);
        channel[username] = {
          ws,
          muted: false
        };

        const existingMembers = voiceMembers(currentChannel)
          .filter((m) => m.username !== username)
          .map((m) => m.username);

        ws.send(JSON.stringify({ type: 'channel-members', members: existingMembers }));

        for (const [memberName, memberState] of Object.entries(channel)) {
          if (memberName !== username && memberState.ws.readyState === WebSocket.OPEN) {
            memberState.ws.send(JSON.stringify({ type: 'new-peer', peerId: username }));
          }
        }

        broadcastVoiceRoster(currentChannel);
        return;
      }

      if (data.type === 'voice-mute-state') {
        const channel = voiceChannels[currentChannel];
        if (channel && username && channel[username]) {
          channel[username].muted = !!data.muted;
          broadcastVoiceRoster(currentChannel);
        }
        return;
      }

      if (['offer', 'answer', 'ice-candidate'].includes(data.type)) {
        const targetState = voiceChannels[currentChannel]?.[data.to];
        if (targetState && targetState.ws.readyState === WebSocket.OPEN) {
          targetState.ws.send(JSON.stringify({ ...data, from: username }));
        }
        return;
      }

      if (data.type === 'leave-channel') {
        const channel = voiceChannels[currentChannel];
        if (channel && username && channel[username]) {
          delete channel[username];

          for (const state of Object.values(channel)) {
            if (state.ws.readyState === WebSocket.OPEN) {
              state.ws.send(JSON.stringify({ type: 'leave', username }));
            }
          }

          if (Object.keys(channel).length === 0) {
            delete voiceChannels[currentChannel];
          } else {
            broadcastVoiceRoster(currentChannel);
          }
        }
      }
    } catch (err) {
      console.error('Voice WS error:', err);
    }
  });

  ws.on('close', () => {
    const channel = voiceChannels[currentChannel];
    if (channel && username && channel[username]) {
      delete channel[username];

      for (const state of Object.values(channel)) {
        if (state.ws.readyState === WebSocket.OPEN) {
          state.ws.send(JSON.stringify({ type: 'leave', username }));
        }
      }

      if (Object.keys(channel).length === 0) {
        delete voiceChannels[currentChannel];
      } else {
        broadcastVoiceRoster(currentChannel);
      }
    }
  });
});

appExpress.use((err, req, res, next) => {
  console.error('Unhandled express error:', err);
  res.status(500).json({ error: 'server error' });
});