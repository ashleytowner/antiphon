import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { PlayerServer, validateOffer } from '../src/main/server';

test('public server serves only listening assets and bounded audio signaling', async () => {
  const server = new PlayerServer({ libraryRoot: '/private', port: 0, udpMin: 44000, udpMax: 44100, publicAddress: '', stunUrl: '', turnUrl: '', turnUsername: '', turnCredential: '' }, path.resolve('dist/player'));
  try {
    await server.start();
    const base = server.status().urls[0];
    const page = await fetch(base);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Listen live/);
    assert.deepEqual(await fetch(`${base}/api/status`).then(r => r.json()), { broadcasting: false });
    assert.equal((await fetch(`${base}/api/library`)).status, 404);
    assert.equal((await fetch(`${base}/api/listen`, { method: 'POST', body: '{}' })).status, 400);
    assert.equal((await fetch(`${base}/api/listen`, { method: 'POST', headers: { Origin: 'http://elsewhere.test' }, body: '{}' })).status, 403);
    assert.throws(() => validateOffer({ type: 'offer', sdp: 'v=0\r\nm=video 9\r\n' }), /Only audio/);
  } finally { await server.close(); }
});
