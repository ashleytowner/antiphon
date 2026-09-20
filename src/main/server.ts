import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { AudioRelay } from './relay';
import type { Settings, ServerStatus } from '../shared/types';

export function validateOffer(value: unknown): { type: 'offer'; sdp: string } {
  const offer = value as { type?: unknown; sdp?: unknown } | null;
  if (offer?.type !== 'offer' || typeof offer.sdp !== 'string' || offer.sdp.length > 64_000 || !offer.sdp.startsWith('v=0')) throw new Error('Invalid audio offer.');
  const media = offer.sdp.match(/^m=.+$/gm) ?? [];
  if (media.length !== 1 || !media[0].startsWith('m=audio ')) throw new Error('Only audio is supported (one mixed audio stream).');
  return { type: 'offer', sdp: offer.sdp };
}
async function jsonBody(request: IncomingMessage) {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) { size += chunk.length; if (size > 65_536) throw new Error('Request too large.'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export class PlayerServer {
  readonly relay: AudioRelay;
  private server = createServer((req, res) => { void this.handle(req, res); });
  private assets = new Map<string, { body: Buffer; type: string }>();
  constructor(readonly settings: Settings, private assetDirectory: string) {
    this.relay = new AudioRelay(settings);
    this.server.requestTimeout = 20_000;
    this.server.headersTimeout = 10_000;
  }
  async start() {
    for (const [route, file, type] of [['/', 'index.html', 'text/html'], ['/player.js', 'player.js', 'text/javascript'], ['/player.css', 'player.css', 'text/css']]) {
      this.assets.set(route, { body: await readFile(path.join(this.assetDirectory, file)), type });
    }
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      this.server.once('error', onError);
      this.server.listen(this.settings.port, '0.0.0.0', () => { this.server.off('error', onError); resolve(); });
    }).catch(async error => { await this.relay.close(); throw error; });
  }
  status(): ServerStatus {
    const address = this.server.address();
    const port = typeof address === 'object' && address ? address.port : this.settings.port;
    const hosts = ['localhost', ...Object.values(networkInterfaces()).flat().filter(i => i?.family === 'IPv4' && !i.internal).map(i => i!.address)];
    if (this.settings.publicAddress) hosts.push(this.settings.publicAddress);
    return { running: this.server.listening, broadcasting: this.relay.broadcasting, listeners: this.relay.count, urls: [...new Set(hosts)].map(host => `http://${host}:${port}`) };
  }
  private async handle(req: IncomingMessage, res: ServerResponse) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self' data:; connect-src 'self'; media-src 'self' blob:; frame-ancestors 'none'");
    const reply = (code: number, data: unknown) => { if (!res.destroyed) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); } };
    try {
      const route = (req.url ?? '/').split('?')[0];
      if (req.method === 'GET' && this.assets.has(route)) {
        const asset = this.assets.get(route)!; res.writeHead(200, { 'Content-Type': asset.type }); res.end(asset.body); return;
      }
      if (req.method === 'GET' && route === '/api/status') { reply(200, { broadcasting: this.relay.broadcasting }); return; }
      // Same-origin signaling; the public server never exposes GM controls or files.
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`) { reply(403, { error: 'Origin not allowed.' }); return; }
      if (req.method === 'POST' && route === '/api/listen') {
        reply(200, await this.relay.listen(validateOffer(await jsonBody(req)))); return;
      }
      const id = /^\/api\/listeners\/([a-f0-9-]{36})$/.exec(route)?.[1];
      if (id && req.method === 'PUT') { reply(this.relay.touch(id) ? 200 : 404, { ok: true }); return; }
      if (id && req.method === 'DELETE') { await this.relay.remove(id); reply(200, { ok: true }); return; }
      reply(404, { error: 'Not found.' });
    } catch (error) { reply(400, { error: error instanceof Error ? error.message : 'Connection failed.' }); }
  }
  async close() {
    const closing = new Promise<void>(resolve => this.server.close(() => resolve()));
    this.server.closeAllConnections();
    await Promise.all([closing, this.relay.close()]);
  }
}
