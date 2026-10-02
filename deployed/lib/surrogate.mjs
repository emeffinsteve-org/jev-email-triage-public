// Surrogate credential for Node: ask authd for the hsurr:* surrogate for a
// connector credential and use it as the Bearer token. authd replaces the
// surrogate with the real key on egress — this process never sees the key.
//
// PORTABILITY NOTE: authd is part of the author's environment (Muse VM).
// To run this pipeline elsewhere, replace getSurrogate() with your own
// secret fetch (env var, vault CLI, etc.) and pass the bearer token to
// the Jev API client in lib/jev.mjs.
import http from 'node:http';

const SOCK = process.env.JARVIS_AUTHD_SOCK || '/run/hatch/auth/authd.sock';

export function getSurrogate(credentialName, entryName = 'access_token') {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ name: credentialName });
    const req = http.request({
      socketPath: SOCK, path: '/v1/credentials/surrogate', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const entry = (json.credentials ?? []).find((e) => e.name === entryName);
          const s = entry?.surrogate?.trim();
          if (s?.startsWith('hsurr:')) return resolve(s);
          reject(new Error(`no surrogate for ${credentialName}:${entryName}`));
        } catch (e) { reject(new Error(`authd surrogate response not JSON: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('authd timeout')));
    req.end(payload);
  });
}
