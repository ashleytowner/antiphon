import { open } from 'node:fs/promises';
import { Readable } from 'node:stream';
import path from 'node:path';

const mime: Record<string, string> = { '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.mp4': 'audio/mp4', '.aac': 'audio/aac', '.webm': 'audio/webm', '.aif': 'audio/aiff', '.aiff': 'audio/aiff' };
/** Range requests let Chromium seek/loop long files without reading them into RAM. */
export async function audioResponse(file: string | undefined, request: Request): Promise<Response> {
  if (!file) return new Response('Track unavailable', { status: 404 });
  if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405 });
  const handle = await open(file, 'r').catch(() => undefined);
  if (!handle) return new Response('File is missing. Re-index the library.', { status: 404 });
  let streaming = false;
  try {
    const { size } = await handle.stat();
    const headers: Record<string, string> = { 'Content-Type': mime[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
    let start = 0, end = size - 1;
    const range = request.headers.get('range');
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
      start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
      end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
      if (start > end || start >= size || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
      headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    }
    headers['Content-Length'] = String(Math.max(0, end - start + 1));
    if (request.method === 'HEAD' || size === 0) return new Response(null, { status: range ? 206 : 200, headers });
    const stream = handle.createReadStream({ start, end, autoClose: true });
    streaming = true;
    return new Response(Readable.toWeb(stream) as ReadableStream, { status: range ? 206 : 200, headers });
  } finally { if (!streaming) await handle.close(); }
}
