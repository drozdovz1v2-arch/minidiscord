const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: 4001 });

/*
  channels = {
    "General": Map {
      username -> ws
    }
  }
*/
const channels = new Map();

function buildVoiceMembers(channelName) {
  const channel = channels.get(channelName);
  if (!channel) return [];

  return Array.from(channel.entries()).map(([username, clientWs]) => ({
    username,
    muted: !!clientWs.isMuted,
    speaking: !!clientWs.isSpeaking
  }));
}

function broadcastVoiceMembers(channelName) {
  const channel = channels.get(channelName);
  if (!channel) return;

  const payload = JSON.stringify({
    type: 'voice-members',
    members: buildVoiceMembers(channelName)
  });

  channel.forEach((clientWs) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(payload);
    }
  });
}

function broadcastSpeaking(ws, speaking) {
  const channel = channels.get(ws.channel);
  if (!channel) return;

  ws.isSpeaking = !!speaking;

  const payload = JSON.stringify({
    type: 'speaking',
    username: ws.username,
    speaking: !!speaking
  });

  channel.forEach((clientWs) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(payload);
    }
  });

  broadcastVoiceMembers(ws.channel);
}

function updateMuteState(ws, muted) {
  const channel = channels.get(ws.channel);
  if (!channel) return;

  ws.isMuted = !!muted;
  broadcastVoiceMembers(ws.channel);
}

// ---------- JOIN ----------
function joinChannel(ws, username, channelName) {
  if (!channels.has(channelName)) {
    channels.set(channelName, new Map());
  }

  const channel = channels.get(channelName);

  // список существующих участников
  const members = Array.from(channel.keys()).filter(u => u !== username);

  // добавить пользователя
  channel.set(username, ws);

  ws.username = username;
  ws.channel = channelName;
  ws.isMuted = false;
  ws.isSpeaking = false;

  // отправить список участников
  ws.send(JSON.stringify({
    type: 'channel-members',
    members
  }));

  // уведомить остальных
  const payload = JSON.stringify({
    type: 'new-peer',
    peerId: username
  });

  channel.forEach((clientWs, user) => {
    if (user !== username && clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(payload);
    }
  });

  console.log(`[VOICE] ${username} joined ${channelName}`);
  broadcastVoiceMembers(channelName);
}

// ---------- LEAVE ----------
function leaveChannel(ws) {
  const username = ws.username;
  const channelName = ws.channel;

  if (!username || !channelName) return;

  const channel = channels.get(channelName);
  if (!channel) return;

  channel.delete(username);

  const payload = JSON.stringify({
    type: 'leave',
    username
  });

  channel.forEach((clientWs) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(payload);
    }
  });

  if (channel.size === 0) {
    channels.delete(channelName);
  }

  broadcastVoiceMembers(channelName);
  console.log(`[VOICE] ${username} left ${channelName}`);
}

// ---------- SIGNALING ----------
function relay(ws, data) {
  const channel = channels.get(ws.channel);
  if (!channel) return;

  const target = channel.get(data.to);
  if (!target || target.readyState !== WebSocket.OPEN) return;

  // добавляем from автоматически
  const payload = {
    ...data,
    from: ws.username
  };

  target.send(JSON.stringify(payload));
}

// ---------- CONNECTION ----------
wss.on('connection', (ws) => {

  ws.on('message', (msg) => {
    let data;

    try {
      data = JSON.parse(msg);
    } catch {
      return;
    }

    // JOIN
    if (data.type === 'join-channel') {
      if (!data.username || !data.channel) return;
      joinChannel(ws, data.username, data.channel);
      return;
    }

    // LEAVE
    if (data.type === 'leave-channel') {
      leaveChannel(ws);
      return;
    }
	
	if (data.type === 'speaking') {
	  broadcastSpeaking(ws, !!data.speaking);
	  return;
	}

	if (data.type === 'voice-mute-state') {
	  updateMuteState(ws, !!data.muted);
	  return;
	}

    // SIGNALING
    if (['offer', 'answer', 'ice-candidate'].includes(data.type)) {
      relay(ws, data);
      return;
    }
  });

  ws.on('close', () => {
    leaveChannel(ws);
  });
});

console.log('Voice server started on ws://0.0.0.0:4001');