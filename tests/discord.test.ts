import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GatewayIntentBits } from 'discord.js';
import { discordGatewayIntents } from '../src/main/discord';

test('Discord client requests voice-state updates required to establish voice connections', () => {
  assert.ok(discordGatewayIntents.includes(GatewayIntentBits.Guilds));
  assert.ok(discordGatewayIntents.includes(GatewayIntentBits.GuildVoiceStates));
});
