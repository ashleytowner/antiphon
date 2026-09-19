import { gatherIce, preferOpus, stereoOffer } from '../shared/rtc';
const toggle = document.querySelector<HTMLButtonElement>('#toggle')!;
const volume = document.querySelector<HTMLInputElement>('#volume')!;
const status = document.querySelector<HTMLElement>('#status')!;
const level = document.querySelector<HTMLElement>('#level')!;
let context: AudioContext | undefined;
let gain: GainNode | undefined;
let source: MediaStreamAudioSourceNode | undefined;
// Chromium requires a playing media element to drive remote WebRTC decoding.
// It stays muted; Web Audio provides the actual output and per-player gain.
const receiver = new Audio();
receiver.muted = true;
receiver.autoplay = true;
let peer: RTCPeerConnection | undefined;
let sessionId: string | undefined;
let playing = false;
let connecting = false;
let started = false;
let retry: ReturnType<typeof setTimeout> | undefined;
let heartbeat: ReturnType<typeof setInterval> | undefined;
let generation = 0;
try { volume.value = localStorage.getItem('volume') ?? '0.8'; } catch { /* Storage may be disabled. */ }
function updateVolume() {
  const value = Math.min(1, Math.max(0, Number(volume.value) || 0));
  if (gain && context) gain.gain.setTargetAtTime(playing ? value : 0, context.currentTime, 0.015);
  level.textContent = `${Math.round(value * 100)}%`;
  try { localStorage.setItem('volume', String(value)); } catch { /* Optional preference. */ }
}
volume.addEventListener('input', updateVolume);
updateVolume();
async function disconnect() {
  const id = sessionId; sessionId = undefined;
  clearInterval(heartbeat); heartbeat = undefined;
  const previous = peer; peer = undefined;
  if (previous) { previous.onconnectionstatechange = null; previous.close(); }
  source?.disconnect(); source = undefined;
  receiver.pause(); receiver.srcObject = null;
  if (id) await fetch(`/api/listeners/${id}`, { method: 'DELETE', keepalive: true }).catch(() => {});
}
function reconnect(message: string) {
  status.textContent = message;
  if (!started || retry) return;
  retry = setTimeout(() => { retry = undefined; void connect(); }, 2500);
}
async function connect() {
  if (connecting || !started) return;
  connecting = true;
  const current = ++generation;
  try {
    await disconnect();
    const available = await fetch('/api/status', { signal: AbortSignal.timeout(8000) }).then(r => r.json());
    if (!available.broadcasting) throw new Error('Waiting for the GM to start broadcasting…');
    status.textContent = 'Connecting to live audio…';
    const next = new RTCPeerConnection({ iceServers: [] }); peer = next;
    preferOpus(next.addTransceiver('audio', { direction: 'recvonly' }));
    next.ontrack = event => {
      source?.disconnect();
      const stream = new MediaStream([event.track]);
      receiver.srcObject = stream;
      void receiver.play().catch(() => { status.textContent = 'Press play again to enable audio in this browser.'; });
      source = context!.createMediaStreamSource(stream);
      source.connect(gain!);
    };
    next.onconnectionstatechange = () => {
      if (next !== peer) return;
      if (next.connectionState === 'connected') status.textContent = playing ? 'Live · connected to your GM' : 'Paused · connected to live audio';
      if (['failed', 'disconnected', 'closed'].includes(next.connectionState)) reconnect('Connection interrupted. Reconnecting…');
    };
    await next.setLocalDescription(stereoOffer(await next.createOffer()));
    await gatherIce(next);
    const response = await fetch('/api/listen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next.localDescription), signal: AbortSignal.timeout(20_000) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? 'Unable to connect.');
    sessionId = result.id;
    if (current !== generation) { await disconnect(); return; }
    await next.setRemoteDescription(result.answer);
    heartbeat = setInterval(() => {
      if (sessionId) void fetch(`/api/listeners/${sessionId}`, { method: 'PUT', signal: AbortSignal.timeout(8000) })
        .then(r => { if (!r.ok) reconnect('Broadcast restarted. Reconnecting…'); })
        .catch(() => reconnect('Connection lost. Reconnecting…'));
    }, 10_000);
    // A peer can remain in connecting when a firewall drops all media packets.
    setTimeout(() => { if (peer === next && next.connectionState !== 'connected') reconnect('Audio connection timed out. Check the GM’s forwarded UDP ports.'); }, 15_000);
  } catch (error) {
    await disconnect();
    reconnect(error instanceof Error ? error.message : 'Unable to connect. Retrying…');
  } finally { connecting = false; }
}
toggle.addEventListener('click', async () => {
  try {
    context ??= new AudioContext();
    if (!gain) { gain = context.createGain(); gain.gain.value = 0; gain.connect(context.destination); }
    await context.resume();
    if (receiver.srcObject && receiver.paused) await receiver.play();
    playing = !playing; started = true;
    toggle.textContent = playing ? 'Ⅱ Pause' : '▶ Listen live';
    updateVolume();
    if (peer?.connectionState === 'connected') status.textContent = playing ? 'Live · connected to your GM' : 'Paused · connected to live audio';
    else if (!connecting && !retry) void connect();
  } catch (error) { status.textContent = `Unable to play audio: ${String(error)}`; }
});
window.addEventListener('pagehide', () => { started = false; generation++; clearTimeout(retry); void disconnect(); });
window.addEventListener('pageshow', event => { if (event.persisted && context) { started = true; void connect(); } });
