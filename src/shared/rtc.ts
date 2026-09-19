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
