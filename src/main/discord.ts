import { PassThrough } from "node:stream";
import { ChannelType, Client, GatewayIntentBits, type Guild } from "discord.js";
import {
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
  type VoiceConnection,
} from "@discordjs/voice";
import type { DiscordStatus, DiscordVoiceChannel } from "../shared/types";
import type { AudioRelay } from "./relay";

const enabled = () => process.env.ANTIPHON_DISCORD_ENABLED !== "false";
export const discordGatewayIntents = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildVoiceStates,
] as const;

/** Optional Discord output. Nothing outside this module depends on Discord SDK objects. */
export class DiscordBroadcaster {
  private client?: Client;
  private token?: string;
  private connection?: VoiceConnection;
  private stream?: PassThrough;
  private unsubscribe?: () => void;
  private channel?: DiscordVoiceChannel;
  private error?: string;
  constructor(private relay: AudioRelay) {}
  status(): DiscordStatus {
    return {
      enabled: enabled(),
      configured: !!this.token,
      connected: this.connection?.state.status === VoiceConnectionStatus.Ready,
      channel: this.channel,
      error: this.error,
    };
  }
  async configure(token: string | null) {
    await this.disconnect();
    this.token = token ?? undefined;
    this.error = undefined;
    await this.client?.destroy();
    this.client = undefined;
  }
  private async ready() {
    if (!enabled())
      throw new Error(
        "Discord broadcasting is disabled by ANTIPHON_DISCORD_ENABLED=false.",
      );
    if (!this.token)
      throw new Error("Save a Discord bot token in Settings first.");
    if (this.client?.isReady()) return this.client;
    await this.client?.destroy();
    const client = new Client({ intents: discordGatewayIntents });
    client.on("error", (error) => {
      this.error = error.message;
    });
    try {
      await client.login(this.token);
      this.client = client;
      return client;
    } catch (error) {
      await client.destroy();
      this.error = `Discord login failed: ${String(error)}`;
      throw new Error(this.error);
    }
  }
  async channels(): Promise<DiscordVoiceChannel[]> {
    const client = await this.ready();
    const channels: DiscordVoiceChannel[] = [];
    for (const guild of client.guilds.cache.values()) {
      const cached = await guild.channels.fetch();
      for (const channel of cached.values()) {
        if (
          !channel ||
          (channel.type !== ChannelType.GuildVoice &&
            channel.type !== ChannelType.GuildStageVoice)
        )
          continue;
        channels.push({
          id: channel.id,
          guildId: guild.id,
          guildName: guild.name,
          name: channel.name,
          type:
            channel.type === ChannelType.GuildStageVoice ? "stage" : "voice",
        });
      }
    }
    return channels.sort(
      (a, b) =>
        a.guildName.localeCompare(b.guildName) || a.name.localeCompare(b.name),
    );
  }
  async connect(target: DiscordVoiceChannel) {
    const client = await this.ready();
    const guild = client.guilds.cache.get(target.guildId);
    if (!guild)
      throw new Error(
        "The bot no longer has access to that server. Refresh the channel list.",
      );
    const channel = await guild.channels.fetch(target.id);
    if (
      !channel ||
      (channel.type !== ChannelType.GuildVoice &&
        channel.type !== ChannelType.GuildStageVoice)
    )
      throw new Error("That Discord voice channel is no longer available.");
    await this.disconnect();
    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guild.id,
      adapterCreator: (guild as Guild).voiceAdapterCreator,
      selfDeaf: true,
      selfMute: false,
    });
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
      const stream = new PassThrough({ highWaterMark: 256 * 1024 });
      const player = createAudioPlayer();
      player.on("error", (error) => {
        this.error = `Discord audio error: ${error.message}`;
      });
      player.play(
        createAudioResource(stream, {
          inputType: StreamType.Opus,
          silencePaddingFrames: 5,
        }),
      );
      connection.subscribe(player);
      this.stream = stream;
      this.unsubscribe = this.relay.subscribeOpus((payload) => {
        if (!stream.destroyed) stream.write(payload);
      });
      this.connection = connection;
      this.channel = target;
      this.error = undefined;
      connection.on(VoiceConnectionStatus.Disconnected, () => {
        if (this.connection === connection) {
          this.error = "Discord disconnected.";
          void this.disconnect();
        }
      });
    } catch (error) {
      connection.destroy();
      this.error =
        error instanceof Error && error.name === "AbortError"
          ? "Discord voice connection timed out. Check that this computer can reach Discord over UDP."
          : `Discord connection failed: ${String(error)}`;
      throw new Error(this.error);
    }
  }
  async disconnect() {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.stream?.end();
    this.stream = undefined;
    const connection = this.connection;
    this.connection = undefined;
    this.channel = undefined;
    connection?.destroy();
  }
  async close() {
    await this.disconnect();
    await this.client?.destroy();
    this.client = undefined;
  }
}
