const http = require('http');
const { initializeNetwork, getNetworkState } = require('../network-setup');

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: 3000,
        path,
        method,
        headers: payload
          ? {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload)
            }
          : {}
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          let data = raw;
          try {
            data = JSON.parse(raw);
          } catch (_) {}
          resolve({ status: res.statusCode, data, raw });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  console.log('MiniDiscord integration test\n');

  const net = await initializeNetwork({
    onStatus: (text) => console.log('[net]', text)
  });
  console.log('[OK] initializeNetwork', JSON.stringify(net));

  const cfg = getNetworkState();
  console.log('[OK] getNetworkState', cfg.host, cfg.isLocalServer ? '(local host)' : '(remote)');

  const info = await request('GET', '/server-info');
  if (info.status === 200 && info.data?.ok) {
    console.log('[OK] GET /server-info');
  } else {
    console.error('[FAIL] GET /server-info', info.status);
  }

  const loginMissing = await request('POST', '/login', { username: '', password: '' });
  if (loginMissing.status === 400) {
    console.log('[OK] POST /login validation');
  } else {
    console.error('[FAIL] POST /login validation', loginMissing.status, loginMissing.data);
  }

  const root = await request('GET', '/');
  if (root.status === 200 && String(root.raw).includes('MiniDiscord')) {
    console.log('[OK] GET /');
  } else {
    console.error('[FAIL] GET /', root.status);
  }

  console.log('\nDone.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Integration test failed:', err);
  process.exit(1);
});
