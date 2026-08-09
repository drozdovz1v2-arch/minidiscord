let localStream = null;
let peers = {};
let ws = null;
let usernameGlobal = null;
let currentChannel = null;

function getWSVoiceURL() {
  if (typeof WS_VOICE_URL !== 'undefined') return WS_VOICE_URL;

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/voicews`;
}

async function initAudio() {
  try {
    if (!window.isSecureContext && location.hostname !== 'localhost') {
      alert('Голосовой чат требует HTTPS или localhost. Сейчас страница открыта не в безопасном режиме.');
      throw new Error('Insecure context');
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert('Браузер не дал доступ к mediaDevices/getUserMedia.');
      throw new Error('mediaDevices unavailable');
    }

    if (!localStream) {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log('[VOICE] localStream OK', localStream);
    }

    return localStream;
  } catch (err) {
    console.error('[VOICE] initAudio failed:', err);
    alert('Не удалось получить доступ к микрофону: ' + (err.message || err.name || err));
    throw err;
  }
}

function createPeerConnection(target) {
  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      {
        urls: 'turn:openrelay.metered.ca:80',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      }
    ]
  });

  peers[target] = pc;

  localStream.getTracks().forEach(track => {
    pc.addTrack(track, localStream);
  });

  pc.ontrack = event => {
    let audio = document.getElementById('audio-' + target);

    if (!audio) {
      audio = document.createElement('audio');
      audio.id = 'audio-' + target;
      audio.autoplay = true;
      document.body.appendChild(audio);
    }

    audio.srcObject = event.streams[0];
  };

  pc.onicecandidate = event => {
    if (event.candidate && ws && ws.readyState === 1) {
      ws.send(JSON.stringify({
        type: 'ice-candidate',
        to: target,
        candidate: event.candidate
      }));
    }
  };

  return pc;
}

async function joinVoiceChannel(username, channel) {
  usernameGlobal = username;
  currentChannel = channel;

  await initAudio();

  ws = new WebSocket(getWSVoiceURL());
  
  ws.onerror = (err) => {
  console.error('[VOICE] websocket error', err);
  alert('Ошибка подключения к voice server на ' + getWSVoiceURL());
  };

  ws.onopen = () => {
    ws.send(JSON.stringify({
      type: 'join-channel',
      username,
      channel
    }));
  };

  ws.onclose = () => {
    if (window.MiniDiscordVoice && window.MiniDiscordVoice.onDisconnect) {
      window.MiniDiscordVoice.onDisconnect();
    }
  };

  ws.onmessage = async (msg) => {
    const data = JSON.parse(msg.data);

    if (data.type === 'channel-members') {
      for (const member of data.members) {
        const pc = createPeerConnection(member);

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        ws.send(JSON.stringify({
          type: 'offer',
          to: member,
          offer
        }));
      }
    }

    if (data.type === 'new-peer') {
      if (!peers[data.peerId]) {
        createPeerConnection(data.peerId);
      }
    }

    if (data.type === 'offer') {
      const pc = createPeerConnection(data.from);

      await pc.setRemoteDescription(new RTCSessionDescription(data.offer));

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      ws.send(JSON.stringify({
        type: 'answer',
        to: data.from,
        answer
      }));
    }

    if (data.type === 'answer') {
      const pc = peers[data.from];
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
      }
    }

    if (data.type === 'ice-candidate') {
      const pc = peers[data.from];
      if (pc && data.candidate) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (_) {}
      }
    }

    if (data.type === 'leave') {
      const pc = peers[data.username];
      if (pc) {
        pc.close();
        delete peers[data.username];
      }

      const audio = document.getElementById('audio-' + data.username);
      if (audio) audio.remove();
    }
  };
}

function leaveVoiceChannel() {
  if (ws) {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'leave-channel' }));
    }
    ws.close();
    ws = null;
  }

  Object.values(peers).forEach(pc => pc.close());
  peers = {};

  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
}

function setMuted(muted) {
  if (!localStream) return;

  localStream.getAudioTracks().forEach(track => {
    track.enabled = !muted;
  });
}

window.MiniDiscordVoice = {
  joinVoiceChannel,
  leaveVoiceChannel,
  setMuted,
  onDisconnect: null
};