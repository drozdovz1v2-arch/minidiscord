const { pickVpnHostIp, isLikelyVpnAddress } = require('./network');

const TURN_USER = 'minidiscord';
const TURN_PASS =
  process.env.VOICE_TURN_SECRET || 'minidiscord-radmin-voice-2026';

const VPN_PREFIXES = ['26.', '25.', '5.'];

function extractCandidateIp(candidateStr) {
  const match = String(candidateStr || '').match(/(\d+\.\d+\.\d+\.\d+)/);
  return match ? match[1] : null;
}

function getCandidateType(candidateStr) {
  const match = String(candidateStr || '').match(/typ (\w+)/);
  return match ? match[1] : '';
}

function isEndOfCandidates(candidate) {
  if (candidate == null) return true;
  const candStr = typeof candidate === 'string' ? candidate : candidate.candidate;
  if (candStr == null || candStr === '') return true;
  return String(candStr).includes('end-of-candidates');
}

function isAllowedVoiceCandidate(candidate, options = {}) {
  if (isEndOfCandidates(candidate)) return true;

  const candStr =
    typeof candidate === 'string' ? candidate : String(candidate?.candidate || '');

  if (!candStr) return false;

  const type = getCandidateType(candStr);

  // TURN relay always allowed (fallback through host)
  if (type === 'relay') return true;

  // mDNS .local host candidates break Radmin routing
  if (/\.local\b/i.test(candStr)) return false;

  const ip = extractCandidateIp(candStr);
  if (!ip) return type === 'host';

  if (ip.startsWith('127.')) return false;

  if (isLikelyVpnAddress(ip)) return true;

  if (type === 'host') {
    if (options.allowLan !== false) {
      if (ip.startsWith('192.168.') || ip.startsWith('10.')) return true;
      const parts = ip.split('.').map(Number);
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    }
  }

  // Public NAT/reflexive candidates are useless inside Radmin
  if (type === 'srflx' || type === 'prflx') return false;

  return false;
}

function filterIceCandidatePayload(candidateObj, options = {}) {
  if (!candidateObj) return null;
  if (isEndOfCandidates(candidateObj)) return candidateObj;

  const candStr = candidateObj.candidate || '';
  if (!isAllowedVoiceCandidate(candStr, options)) return null;
  return candidateObj;
}

function buildVoiceIceConfig(vpnHost, turnPort = 3478) {
  const host = vpnHost || pickVpnHostIp();
  const port = Number(turnPort || 3478);
  const iceServers = [];

  if (host && host !== '127.0.0.1') {
    iceServers.push({ urls: `stun:${host}:${port}` });
    iceServers.push({
      urls: [
        `turn:${host}:${port}?transport=udp`,
        `turn:${host}:${port}?transport=tcp`
      ],
      username: TURN_USER,
      credential: TURN_PASS
    });
  } else {
    iceServers.push({ urls: 'stun:stun.l.google.com:19302' });
  }

  return {
    iceServers,
    iceTransportPolicy: 'all',
    iceCandidatePoolSize: 10,
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require'
  };
}

function getVoiceConfigPayload(vpnHost, turnPort = 3478) {
  const host = vpnHost || pickVpnHostIp();

  return {
    ok: true,
    vpnHost: host,
    turnPort: Number(turnPort || 3478),
    radminOnly: true,
    turnUser: TURN_USER,
    allowedPrefixes: VPN_PREFIXES,
    rtcConfig: buildVoiceIceConfig(host, turnPort)
  };
}

module.exports = {
  TURN_USER,
  TURN_PASS,
  VPN_PREFIXES,
  extractCandidateIp,
  getCandidateType,
  isEndOfCandidates,
  isAllowedVoiceCandidate,
  filterIceCandidatePayload,
  buildVoiceIceConfig,
  getVoiceConfigPayload
};
