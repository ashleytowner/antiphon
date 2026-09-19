import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RTCPeerConnection, MediaStreamTrack, RtpPacket, RtpHeader, useOPUS } from 'werift';
import { AudioRelay } from '../src/main/relay';
import type { Settings } from '../src/shared/types';

export const testSettings: Settings = { libraryRoot: '', port: 0, udpMin: 44000, udpMax: 44100, publicAddress: '', stunUrl: '', turnUrl: '', turnUsername: '', turnCredential: '' };
const peer = () => new RTCPeerConnection({ iceServers: [], iceUseIpv6: false, iceInterfaceAddresses: { udp4: '127.0.0.1' }, iceAdditionalHostAddresses: ['127.0.0.1'], codecs: { audio: [useOPUS({ parameters: 'stereo=1;sprop-stereo=1' })] } });
async function until(check: () => boolean, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (!check()) { if (Date.now() > deadline) throw new Error('Timed out waiting for WebRTC'); await new Promise(r => setTimeout(r, 20)); }
}
test('relays live Opus to eight listeners, supports late joins, and releases sessions', { timeout: 90000 }, async () => {
  const relay = new AudioRelay(testSettings);
  const publisher = peer();
  const listeners: RTCPeerConnection[] = [];
  let timer: NodeJS.Timeout | undefined;
  try {
    const source = new MediaStreamTrack({ kind: 'audio' });
    publisher.addTrack(source);
    await publisher.setLocalDescription(await publisher.createOffer());
    await publisher.setRemoteDescription(await relay.publish(publisher.localDescription!));
    await until(() => relay.broadcasting && publisher.connectionState === 'connected');
    let sequence = 0;
    timer = setInterval(() => {
      sequence++;
      source.writeRtp(new RtpPacket(new RtpHeader({ payloadType: 96, sequenceNumber: sequence, timestamp: sequence * 960, ssrc: 12345 }), Buffer.from([0xf8, 0xff, 0xfe])));
    }, 20);
    const counts: number[] = [];
    const timestamps: number[] = [];
    const ids: string[] = [];
    await Promise.all(Array.from({ length: 8 }, async (_, i) => {
      const listener = peer(); listeners.push(listener); counts[i] = 0;
      listener.addTransceiver('audio', { direction: 'recvonly' });
      listener.onTrack.subscribe(track => track.onReceiveRtp.subscribe(packet => { counts[i]++; timestamps[i] = packet.header.timestamp; }));
      await listener.setLocalDescription(await listener.createOffer());
      const { id, answer } = await relay.listen(listener.localDescription!);
      ids[i] = id;
      // All server host media candidates are constrained to the configured range.
      for (const candidate of answer.sdp.matchAll(/a=candidate:.*? udp \d+ \S+ (\d+)/gi)) assert.ok(Number(candidate[1]) >= testSettings.udpMin && Number(candidate[1]) <= testSettings.udpMax);
      await listener.setRemoteDescription(answer);
    }));
    await until(() => counts.length === 8 && counts.every(c => c > 4));
    assert.equal(relay.count, 8);
    assert.ok(Math.max(...timestamps) - Math.min(...timestamps) <= 4800, 'listeners receive the same live timeline');
    assert.equal(relay.touch(ids[0]), true);
    await relay.remove(ids[0]);
    assert.equal(relay.touch(ids[0]), false);
    assert.equal(relay.count, 7);
    await relay.stopPublisher();
    assert.equal(relay.broadcasting, false);
    assert.equal(relay.count, 0);
    await assert.rejects(relay.listen(listeners[0].localDescription!), /not started/);
  } finally {
    clearInterval(timer);
    await Promise.all([publisher.close(), ...listeners.map(p => p.close()), relay.close()]);
  }
});
