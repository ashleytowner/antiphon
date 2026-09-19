import { randomUUID } from 'node:crypto';
import { RTCPeerConnection, MediaStreamTrack, useOPUS, type RTCSessionDescriptionInit } from 'werift';
import type { Settings } from '../shared/types';

const codec = () => useOPUS({ parameters: 'minptime=10;useinbandfec=1;stereo=1;sprop-stereo=1;maxaveragebitrate=192000' });
interface Listener { peer: RTCPeerConnection; touched: number }

/** The desktop encodes once; this endpoint forwards Opus packets without transcoding. */
export class AudioRelay {
  private publisher?: RTCPeerConnection;
  private listeners = new Map<string, Listener>();
  private unsubscribe?: () => void;
  private sweep: NodeJS.Timeout;
  private closed = false;
  constructor(private settings: Settings) {
    this.sweep = setInterval(() => {
      for (const [id, listener] of this.listeners) if (Date.now() - listener.touched > 45_000) void this.remove(id);
    }, 10_000);
    this.sweep.unref();
  }
  get broadcasting() { return this.publisher?.connectionState === 'connected'; }
  get count() { return [...this.listeners.values()].filter(l => l.peer.connectionState === 'connected').length; }
  private createPeer(local = false) {
    const iceServers = [];
    if (!local && this.settings.stunUrl) iceServers.push({ urls: this.settings.stunUrl });
    if (!local && this.settings.turnUrl) iceServers.push({ urls: this.settings.turnUrl, username: this.settings.turnUsername, credential: this.settings.turnCredential });
    return new RTCPeerConnection({
      codecs: { audio: [codec()], video: [] }, iceServers, iceUseIpv6: false, iceLite: iceServers.length === 0,
      bundlePolicy: 'max-bundle', iceUseTcp: false,
      ...(local ? { iceInterfaceAddresses: { udp4: '127.0.0.1' }, iceAdditionalHostAddresses: ['127.0.0.1'] }
        : { icePortRange: [this.settings.udpMin, this.settings.udpMax] as [number, number],
          iceAdditionalHostAddresses: this.settings.publicAddress ? [this.settings.publicAddress] : [] }),
    });
  }
  async publish(offer: RTCSessionDescriptionInit) {
    if (this.closed) throw new Error('Server is closed.');
    await this.stopPublisher();
    const peer = this.createPeer(true);
    this.publisher = peer;
    peer.onTrack.subscribe(track => {
      if (track.kind !== 'audio') return;
      this.unsubscribe = track.onReceiveRtp.subscribe(packet => {
        // sendRtp rewrites the header, so each destination receives its own buffer.
        const data = packet.serialize();
        for (const { peer: listener } of this.listeners.values()) if (listener.connectionState === 'connected') {
          const sender = listener.getSenders()[0];
          void sender.sendRtp(Buffer.from(data)).catch(() => { /* ICE state handles network loss. */ });
        }
      }).unSubscribe;
    });
    try {
      await peer.setRemoteDescription(offer);
      await peer.setLocalDescription(await peer.createAnswer());
      if (this.closed || this.publisher !== peer) throw new Error('Broadcast was stopped.');
      return { type: peer.localDescription!.type, sdp: peer.localDescription!.sdp };
    } catch (error) { if (this.publisher === peer) this.publisher = undefined; await peer.close(); throw error; }
  }
  async listen(offer: RTCSessionDescriptionInit) {
    if (this.closed || !this.broadcasting) throw new Error('The GM has not started broadcasting yet.');
    if (this.listeners.size >= 12) throw new Error('All listener slots are occupied. Try again shortly.');
    const id = randomUUID();
    const peer = this.createPeer();
    this.listeners.set(id, { peer, touched: Date.now() });
    peer.addTransceiver(new MediaStreamTrack({ kind: 'audio' }), { direction: 'sendonly' });
    peer.connectionStateChange.subscribe(state => { if (state === 'failed' || state === 'closed') void this.remove(id); });
    try {
      await peer.setRemoteDescription(offer);
      await peer.setLocalDescription(await peer.createAnswer());
      if (this.closed || !this.listeners.has(id)) throw new Error('Connection was closed.');
      return { id, answer: { type: peer.localDescription!.type, sdp: peer.localDescription!.sdp } };
    } catch (error) { await this.remove(id); throw error; }
  }
  touch(id: string) { const listener = this.listeners.get(id); if (listener) listener.touched = Date.now(); return !!listener; }
  async remove(id: string) { const listener = this.listeners.get(id); this.listeners.delete(id); await listener?.peer.close(); }
  async stopPublisher() {
    this.unsubscribe?.(); this.unsubscribe = undefined;
    const peer = this.publisher; this.publisher = undefined;
    // A fresh session prevents stale RTP timestamps after publisher replacement.
    await Promise.all([...this.listeners.keys()].map(id => this.remove(id)));
    await peer?.close();
  }
  async close() { this.closed = true; clearInterval(this.sweep); await this.stopPublisher(); }
}
