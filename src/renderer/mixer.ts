import type { DesktopAPI, Track } from "../shared/types";
import { gatherIce, preferOpus, stereoOffer } from "../shared/rtc";
import { OPUS_MAX_BITRATE } from "../shared/constants";

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
export interface Preview {
  id: string;
  track: Track;
  audio: HTMLAudioElement;
  source: MediaElementAudioSourceNode;
  gain: GainNode;
  playing: boolean;
  error?: string;
}
interface MediaNodes {
  audio: HTMLAudioElement;
  source: MediaElementAudioSourceNode;
  gain: GainNode;
}
type PlaybackState = MediaNodes & { playing: boolean; error?: string };
const MEDIA_ERROR =
  "Unable to decode or read this file. Check that it exists and is a supported audio format.";

export class Mixer {
  private context?: AudioContext;
  private bus?: DynamicsCompressorNode;
  private monitor?: GainNode;
  private destination?: MediaStreamAudioDestinationNode;
  private keepalive?: OscillatorNode;
  private channels = new Map<string, Channel>();
  preview?: Preview;
  private callbacks = new Set<() => void>();
  private mediaCleanup = new WeakMap<HTMLAudioElement, () => void>();
  private peer?: RTCPeerConnection;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private generation = 0;
  private connectionAttempt?: Promise<void>;
  master = 1.0;
  wantsBroadcast = false;
  playerBroadcast = false;
  private discordBroadcast = false;
  broadcastState = "Offline";
  constructor(private api: DesktopAPI) {}
  subscribe(callback: () => void) {
    this.callbacks.add(callback);
    return () => {
      this.callbacks.delete(callback);
    };
  }
  private emit() {
    this.callbacks.forEach((callback) => callback());
  }
  list() {
    return [...this.channels.values()];
  }
  private async ready() {
    if (!this.context) {
      this.context = new AudioContext({
        sampleRate: 48000,
        latencyHint: "interactive",
      });
      this.bus = this.context.createDynamicsCompressor();
      this.bus.threshold.value = -1;
      this.bus.knee.value = 0;
      this.bus.ratio.value = 20;
      this.bus.attack.value = 0.003;
      this.bus.release.value = 0.15;
      this.monitor = this.context.createGain();
      this.monitor.gain.value = this.master;
      this.destination = this.context.createMediaStreamDestination();
      this.destination.channelCount = 2;
      this.bus.connect(this.monitor).connect(this.context.destination);
      this.bus.connect(this.destination);
      // Maintain a live silent stream even between cues, without microphone access.
      this.keepalive = this.context.createOscillator();
      const silence = this.context.createGain();
      silence.gain.value = 0;
      this.keepalive.connect(silence).connect(this.bus);
      this.keepalive.start();
    }
    await this.context.resume();
  }
  private createMedia(
    track: Track,
    volume: number,
    destination: AudioNode,
  ): MediaNodes {
    const audio = new Audio();
    audio.crossOrigin = "anonymous";
    audio.preload = "metadata";
    audio.src = `rpg-audio://track/${track.id}`;
    const source = this.context!.createMediaElementSource(audio);
    const gain = this.context!.createGain();
    gain.gain.value = volume;
    source.connect(gain).connect(destination);
    return { audio, source, gain };
  }
  private watchMedia(
    state: PlaybackState,
    isCurrent: () => boolean = () => true,
  ) {
    const update = () => {
      if (!isCurrent()) return;
      state.playing = !state.audio.paused && !state.audio.ended;
      this.emit();
    };
    const fail = () => {
      if (!isCurrent()) return;
      state.error = MEDIA_ERROR;
      state.playing = false;
      this.emit();
    };
    state.audio.addEventListener("playing", update);
    state.audio.addEventListener("pause", update);
    state.audio.addEventListener("ended", update);
    state.audio.addEventListener("error", fail);
    this.mediaCleanup.set(state.audio, () => {
      state.audio.removeEventListener("playing", update);
      state.audio.removeEventListener("pause", update);
      state.audio.removeEventListener("ended", update);
      state.audio.removeEventListener("error", fail);
    });
  }
  private disposeMedia({ audio, source, gain }: MediaNodes) {
    this.mediaCleanup.get(audio)?.();
    this.mediaCleanup.delete(audio);
    audio.pause();
    source.disconnect();
    gain.disconnect();
    audio.removeAttribute("src");
    audio.load();
  }
  async add(track: Track) {
    await this.ready();
    const { audio, source, gain } = this.createMedia(track, 1.0, this.bus!);
    const channel: Channel = {
      id: crypto.randomUUID(),
      track,
      audio,
      source,
      gain,
      volume: 1.0,
      loop: track.type !== "SFX",
      playing: false,
    };
    audio.loop = channel.loop;
    this.watchMedia(channel, () => this.channels.has(channel.id));
    this.channels.set(channel.id, channel);
    this.emit();
    try {
      await audio.play();
    } catch (error) {
      if (this.channels.has(channel.id)) {
        channel.error = String(error);
        this.emit();
      }
    }
  }
  async togglePreview(track: Track) {
    if (this.preview?.track.id === track.id && this.preview.playing) {
      this.stopPreview();
      return;
    }
    this.stopPreview();
    await this.ready();
    // Preview reaches the GM monitor only; it must not enter the broadcast bus.
    const { audio, source, gain } = this.createMedia(track, 1, this.monitor!);
    const preview: Preview = {
      id: crypto.randomUUID(),
      track,
      audio,
      source,
      gain,
      playing: false,
    };
    this.preview = preview;
    this.watchMedia(preview, () => this.preview === preview);
    this.emit();
    try {
      await audio.play();
    } catch (error) {
      if (this.preview === preview) {
        preview.error = String(error);
        this.emit();
      }
    }
  }
  stopPreview() {
    const preview = this.preview;
    if (!preview) return;
    this.preview = undefined;
    this.disposeMedia(preview);
    this.emit();
  }
  async toggle(id: string) {
    const channel = this.channels.get(id);
    if (!channel) return;
    if (!channel.audio.paused) channel.audio.pause();
    else {
      await this.ready();
      channel.error = undefined;
      try {
        await channel.audio.play();
      } catch (error) {
        channel.error = String(error);
        this.emit();
      }
    }
  }
  volume(id: string, value: number) {
    const channel = this.channels.get(id);
    if (!channel) return;
    channel.volume = value;
    channel.gain.gain.setTargetAtTime(value, this.context!.currentTime, 0.015);
    this.emit();
  }
  loop(id: string, value: boolean) {
    const channel = this.channels.get(id);
    if (!channel) return;
    channel.loop = value;
    channel.audio.loop = value;
    this.emit();
  }
  setMaster(value: number) {
    this.master = value;
    this.monitor?.gain.setTargetAtTime(value, this.context!.currentTime, 0.015);
    this.emit();
  }
  remove(id: string) {
    const channel = this.channels.get(id);
    if (!channel) return;
    this.channels.delete(id);
    this.disposeMedia(channel);
    this.emit();
  }
  clear() {
    this.stopPreview();
    for (const id of this.channels.keys()) this.remove(id);
  }
  async startBroadcast() {
    this.playerBroadcast = true;
    this.wantsBroadcast = true;
    this.emit();
    try {
      await this.api.enablePlayerListeners();
      await this.ensureBroadcast();
    } catch (error) {
      this.playerBroadcast = false;
      this.wantsBroadcast = this.discordBroadcast;
      this.emit();
      throw error;
    }
  }
  async startDiscord() {
    this.discordBroadcast = true;
    this.wantsBroadcast = true;
    this.emit();
    try {
      if (!this.playerBroadcast) await this.api.disablePlayerListeners();
      await this.ensureBroadcast();
    } catch (error) {
      this.discordBroadcast = false;
      this.wantsBroadcast = this.playerBroadcast;
      this.emit();
      throw error;
    }
  }
  private async ensureBroadcast() {
    if (this.connectionAttempt) {
      await this.connectionAttempt;
      // A stop followed immediately by a start invalidates the old attempt.
      // Start the newly requested generation once that attempt has unwound.
      if (this.wantsBroadcast && !this.peer) await this.ensureBroadcast();
      return;
    }
    const attempt = this.connectBroadcast();
    this.connectionAttempt = attempt;
    try {
      await attempt;
    } finally {
      if (this.connectionAttempt === attempt)
        this.connectionAttempt = undefined;
    }
  }
  private async connectBroadcast() {
    const generation = ++this.generation;
    try {
      await this.ready();
      if (generation !== this.generation) return;
      this.broadcastState = "Connecting…";
      this.emit();
      this.peer?.close();
      const peer = new RTCPeerConnection({ iceServers: [] });
      this.peer = peer;
      const sender = peer.addTrack(
        this.destination!.stream.getAudioTracks()[0],
        this.destination!.stream,
      );
      preferOpus(peer.getTransceivers()[0]);
      peer.onconnectionstatechange = () => {
        if (peer !== this.peer) return;
        if (peer.connectionState === "connected") {
          this.broadcastState = "Live";
          this.emit();
        } else if (["failed", "disconnected"].includes(peer.connectionState))
          this.scheduleReconnect();
      };
      setTimeout(() => {
        if (this.peer === peer && peer.connectionState !== "connected") {
          this.broadcastState = "Audio connection timed out. Retrying…";
          this.emit();
          this.scheduleReconnect();
        }
      }, 15_000);
      await peer.setLocalDescription(stereoOffer(await peer.createOffer()));
      await gatherIce(peer);
      if (generation !== this.generation) return;
      const answer = await this.api.broadcast(peer.localDescription!.toJSON());
      if (generation !== this.generation) return;
      await peer.setRemoteDescription(answer);
      const parameters = sender.getParameters();
      if (parameters.encodings.length) {
        parameters.encodings[0].maxBitrate = OPUS_MAX_BITRATE;
        await sender.setParameters(parameters);
      }
    } catch (error) {
      if (generation !== this.generation) return;
      this.broadcastState = `Connection error: ${String(error)}`;
      this.emit();
      this.scheduleReconnect();
    }
  }
  private scheduleReconnect() {
    if (!this.wantsBroadcast || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (this.wantsBroadcast) void this.ensureBroadcast();
    }, 3000);
  }
  async stopBroadcast() {
    this.playerBroadcast = false;
    await this.api.disablePlayerListeners();
    if (this.discordBroadcast) {
      this.emit();
      return;
    }
    await this.stopSource();
  }
  async stopDiscord() {
    this.discordBroadcast = false;
    if (this.playerBroadcast) {
      this.emit();
      return;
    }
    await this.stopSource();
  }
  async stopAllBroadcasts() {
    this.playerBroadcast = false;
    this.discordBroadcast = false;
    await this.api.disablePlayerListeners();
    await this.stopSource();
  }
  private async stopSource() {
    this.wantsBroadcast = false;
    this.generation++;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    const peer = this.peer;
    this.peer = undefined;
    peer?.close();
    this.broadcastState = "Offline";
    this.emit();
    await this.api.stopBroadcast();
  }
}
