export async function gatherIce(peer: RTCPeerConnection, timeout = 10_000): Promise<void> {
  if (peer.iceGatheringState === 'complete') return;
  await new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => { clearTimeout(timer); peer.removeEventListener('icegatheringstatechange', change); peer.removeEventListener('connectionstatechange', change); error ? reject(error) : resolve(); };
    const change = () => {
      if (peer.connectionState === 'closed') finish(new Error('Connection closed.'));
      else if (peer.iceGatheringState === 'complete') finish();
    };
    const timer = setTimeout(() => finish(new Error('Timed out preparing the audio connection.')), timeout);
    peer.addEventListener('icegatheringstatechange', change);
    peer.addEventListener('connectionstatechange', change);
    change();
  });
}

export function preferOpus(transceiver: RTCRtpTransceiver) {
  const codecs = RTCRtpReceiver.getCapabilities('audio')?.codecs.filter(c => c.mimeType.toLowerCase() === 'audio/opus');
  if (codecs?.length) transceiver.setCodecPreferences(codecs);
}

/** Opus defaults to mono unless stereo is explicitly negotiated in SDP. */
export function stereoOffer(offer: RTCSessionDescriptionInit): RTCSessionDescriptionInit {
  let sdp = offer.sdp ?? '';
  const opus = [...sdp.matchAll(/^a=rtpmap:(\d+) opus\/48000\/2\r?$/gim)].map(match => match[1]);
  for (const payload of opus) {
    const pattern = new RegExp(`^a=fmtp:${payload} (.*)\\r?$`, 'gm');
    sdp = sdp.replace(pattern, (_line, parameters: string) => {
      const values = parameters.trim().split(';').filter(p => !/^(?:stereo|sprop-stereo|maxaveragebitrate)=/.test(p.trim()));
      return `a=fmtp:${payload} ${[...values, 'stereo=1', 'sprop-stereo=1', `maxaveragebitrate=${OPUS_MAX_BITRATE}`].join(';')}\r`;
    });
  }
  return { type: offer.type, sdp };
}
import { OPUS_MAX_BITRATE } from './constants';
