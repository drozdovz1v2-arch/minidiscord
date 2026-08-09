const dgram = require('dgram');

const DISCOVERY_PORT = 41234;
const MAGIC = 'minidiscord-v1';

let serviceSocket = null;

function parseMessage(raw) {
  try {
    const data = JSON.parse(raw.toString());
    if (data?.magic !== MAGIC) return null;
    return data;
  } catch (_) {
    return null;
  }
}

function buildAnnounce(info) {
  return JSON.stringify({
    magic: MAGIC,
    type: 'announce',
    host: info.host,
    httpPort: info.httpPort,
    voicePort: info.voicePort,
    turnPort: info.turnPort || 3478,
    product: 'MiniDiscord'
  });
}

function startDiscoveryService(getInfo) {
  if (serviceSocket) return serviceSocket;

  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  socket.on('error', (err) => {
    console.error('[discovery] service error:', err.message);
  });

  socket.on('message', (raw, rinfo) => {
    const data = parseMessage(raw);
    if (!data || data.type !== 'discover') return;

    const info = getInfo();
    if (!info?.host) return;

    const payload = Buffer.from(buildAnnounce(info));
    socket.send(payload, rinfo.port, rinfo.address, (err) => {
      if (err) console.error('[discovery] reply error:', err.message);
    });
  });

  socket.bind(DISCOVERY_PORT, () => {
    try {
      socket.setBroadcast(true);
    } catch (_) {}

    const announce = () => {
      const info = getInfo();
      if (!info?.host) return;

      const payload = Buffer.from(buildAnnounce(info));
      socket.send(payload, DISCOVERY_PORT, '255.255.255.255', () => {});
    };

    announce();
    setInterval(announce, 4000);
  });

  serviceSocket = socket;
  return socket;
}

function discoverServers(timeoutMs = 2800) {
  return new Promise((resolve) => {
    const found = new Map();
    let finished = false;

    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    const finish = () => {
      if (finished) return;
      finished = true;

      try {
        socket.close();
      } catch (_) {}

      resolve(Array.from(found.values()));
    };

    socket.on('error', () => finish());

    socket.on('message', (raw) => {
      const data = parseMessage(raw);
      if (!data || data.type !== 'announce' || !data.host) return;

      found.set(data.host, {
        host: data.host,
        httpPort: data.httpPort || 3000,
        voicePort: data.voicePort || 4001,
        turnPort: data.turnPort || 3478
      });
    });

    socket.bind(0, () => {
      try {
        socket.setBroadcast(true);
      } catch (_) {}

      const payload = Buffer.from(JSON.stringify({
        magic: MAGIC,
        type: 'discover'
      }));

      const ping = () => {
        socket.send(payload, DISCOVERY_PORT, '255.255.255.255', () => {});
      };

      ping();
      const timer = setInterval(ping, 450);

      setTimeout(() => {
        clearInterval(timer);
        finish();
      }, timeoutMs);
    });
  });
}

function stopDiscoveryService() {
  if (!serviceSocket) return;

  try {
    serviceSocket.close();
  } catch (_) {}

  serviceSocket = null;
}

module.exports = {
  DISCOVERY_PORT,
  startDiscoveryService,
  discoverServers,
  stopDiscoveryService
};
