import type { DesktopAPI, Track } from '../shared/types';
import { gatherIce, preferOpus, stereoOffer } from '../shared/rtc';

export interface Channel {
  id: string;
  track: Track;
  audio: HTMLAudioElement;
  source: MediaElementAudioSourceNode;
  gain: GainNode;
  volume: number;
  loop: boolean;
  playing: boolean;
  error?: string;
}
export class Mixer {
  private context?: AudioContext;
  private bus?: DynamicsCompressorNode;
  private monitor?: GainNode;
  private destination?: MediaStreamAudioDestinationNode;
  private keepalive?: OscillatorNode;
  private channels = new Map<string, Channel>();
  private callbacks = new Set<() => void>();
  private peer?: RTCPeerConnection;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private generation = 0;
  private connecting = false;
  master = 0.8;
  wantsBroadcast = false;
  broadcastState = 'Offline';
  constructor(private api: DesktopAPI) {}
  subscribe(callback: () => void) { this.callbacks.add(callback); return () => { this.callbacks.delete(callback); }; }
  private emit() { this.callbacks.forEach(callback => callback()); }
  list() { return [...this.channels.values()]; }
  private async ready() {
    if (!this.context) {
      this.context = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
      this.bus = this.context.createDynamicsCompressor();
      this.bus.threshold.value = -1; this.bus.knee.value = 0; this.bus.ratio.value = 20;
      this.bus.attack.value = 0.003; this.bus.release.value = 0.15;
      this.monitor = this.context.createGain(); this.monitor.gain.value = this.master;
      this.destination = this.context.createMediaStreamDestination();
      this.destination.channelCount = 2;
      this.bus.connect(this.monitor).connect(this.context.destination);
      this.bus.connect(this.destination);
      // Maintain a live silent stream even between cues, without microphone access.
      this.keepalive = this.context.createOscillator();
      const silence = this.context.createGain(); silence.gain.value = 0;
      this.keepalive.connect(silence).connect(this.bus); this.keepalive.start();
    }
    await this.context.resume();
  }
  async add(track: Track) {
    await this.ready();
    const audio = new Audio();
    audio.crossOrigin = 'anonymous'; audio.preload = 'metadata';
    audio.src = `rpg-audio://track/${track.id}`;
    const source = this.context!.createMediaElementSource(audio);
    const gain = this.context!.createGain();
    gain.gain.value = 0.7;
    source.connect(gain).connect(this.bus!);
    const channel: Channel = { id: crypto.randomUUID(), track, audio, source, gain, volume: 0.7, loop: track.type !== 'SFX', playing: false };
    audio.loop = channel.loop;
    const update = () => { channel.playing = !audio.paused && !audio.ended; this.emit(); };
    audio.addEventListener('playing', update); audio.addEventListener('pause', update); audio.addEventListener('ended', update);
    audio.addEventListener('error', () => { channel.error = 'Unable to decode or read this file. Check that it exists and is a supported audio format.'; channel.playing = false; this.emit(); });
    this.channels.set(channel.id, channel); this.emit();
    try { await audio.play(); }
    catch (error) { if (this.channels.has(channel.id)) { channel.error = String(error); this.emit(); } }
  }
  async toggle(id: string) {
    const channel = this.channels.get(id); if (!channel) return;
    if (!channel.audio.paused) channel.audio.pause();
    else {
      await this.ready(); channel.error = undefined;
      try { await channel.audio.play(); }
      catch (error) { channel.error = String(error); this.emit(); }
    }
  }
  volume(id: string, value: number) {
    const channel = this.channels.get(id); if (!channel) return;
    channel.volume = value; channel.gain.gain.setTargetAtTime(value, this.context!.currentTime, 0.015); this.emit();
  }
  loop(id: string, value: boolean) {
    const channel = this.channels.get(id); if (!channel) return;
    channel.loop = value; channel.audio.loop = value; this.emit();
  }
  setMaster(value: number) {
    this.master = value;
    this.monitor?.gain.setTargetAtTime(value, this.context!.currentTime, 0.015);
    this.emit();
  }
  remove(id: string) {
    const channel = this.channels.get(id); if (!channel) return;
    this.channels.delete(id); channel.audio.pause(); channel.source.disconnect(); channel.gain.disconnect();
    channel.audio.removeAttribute('src'); channel.audio.load(); this.emit();
  }
  clear() { for (const id of this.channels.keys()) this.remove(id); }
  async startBroadcast() {
    this.wantsBroadcast = true;
    if (this.connecting) return;
    this.connecting = true;
    const generation = ++this.generation;
    try {
      await this.ready();
      if (generation !== this.generation) return;
      this.broadcastState = 'Connecting…'; this.emit();
      this.peer?.close();
      const peer = new RTCPeerConnection({ iceServers: [] }); this.peer = peer;
      const sender = peer.addTrack(this.destination!.stream.getAudioTracks()[0], this.destination!.stream);
      preferOpus(peer.getTransceivers()[0]);
      peer.onconnectionstatechange = () => {
        if (peer !== this.peer) return;
        if (peer.connectionState === 'connected') { this.broadcastState = 'Live'; this.emit(); }
        else if (['failed', 'disconnected'].includes(peer.connectionState)) this.scheduleReconnect();
      };
      setTimeout(() => {
        if (this.peer === peer && peer.connectionState !== 'connected') {
          this.broadcastState = 'Audio connection timed out. Retrying…'; this.emit(); this.scheduleReconnect();
        }
      }, 15_000);
      await peer.setLocalDescription(stereoOffer(await peer.createOffer()));
      await gatherIce(peer);
      if (generation !== this.generation) return;
      const answer = await this.api.broadcast(peer.localDescription!.toJSON());
      if (generation !== this.generation) return;
      await peer.setRemoteDescription(answer);
      const parameters = sender.getParameters();
      if (parameters.encodings.length) { parameters.encodings[0].maxBitrate = 192000; await sender.setParameters(parameters); }
    } catch (error) {
      if (generation !== this.generation) return;
      this.broadcastState = `Connection error: ${String(error)}`; this.emit(); this.scheduleReconnect();
    } finally { this.connecting = false; }
  }
  private scheduleReconnect() {
    if (!this.wantsBroadcast || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = undefined; if (this.wantsBroadcast) void this.startBroadcast(); }, 3000);
  }
  async stopBroadcast() {
    this.wantsBroadcast = false; this.generation++;
    clearTimeout(this.reconnectTimer); this.reconnectTimer = undefined;
    const peer = this.peer; this.peer = undefined; peer?.close();
    this.broadcastState = 'Offline'; this.emit();
    await this.api.stopBroadcast();
  }
}
