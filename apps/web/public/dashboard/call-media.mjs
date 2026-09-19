/** Browser audio adapter. No account, HTTP or fare decisions belong here. */
export function createCallMedia({ devices = globalThis.navigator?.mediaDevices,
  Peer = globalThis.RTCPeerConnection, Stream = globalThis.MediaStream,
  secure = globalThis.isSecureContext, timeout = setTimeout, clear = clearTimeout } = {}) {
  const stop = (stream) => stream?.getTracks().forEach((track) => track.stop());
  return Object.freeze({
    supported: () => Boolean(secure && devices?.getUserMedia && Peer),
    acquire: () => devices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false }),
    stop,
    connect(configuration, stream, { onState, onRemote }) {
      const peer = new Peer(configuration);
      let closed = false, cancelGather = null;
      for (const track of stream.getAudioTracks()) {
        peer.addTrack(track, stream);
        track.addEventListener('ended', () => { if (!closed) onState('failed'); });
      }
      peer.addEventListener('track', (event) => {
        if (!closed && event.track.kind === 'audio') onRemote(event.streams[0] ?? new Stream([event.track]));
      });
      peer.addEventListener('connectionstatechange', () => { if (!closed) onState(peer.connectionState); });
      function gather() {
        if (closed) return Promise.reject(new Error('Call ended.'));
        if (peer.iceGatheringState === 'complete') return Promise.resolve();
        return new Promise((resolve, reject) => {
          let timer;
          const finish = (error) => {
            clear(timer); peer.removeEventListener('icegatheringstatechange', changed); cancelGather = null;
            if (error) reject(error); else resolve();
          };
          const changed = () => { if (peer.iceGatheringState === 'complete') finish(); };
          cancelGather = () => finish(new Error('Call ended.'));
          peer.addEventListener('icegatheringstatechange', changed);
          timer = timeout(() => finish(new Error('Audio network setup timed out. Try again or use chat.')), 10_000);
          changed();
        });
      }
      return Object.freeze({
        connected: () => peer.connectionState === 'connected',
        async describe(type, remote) {
          if (remote) await peer.setRemoteDescription(remote);
          if (closed) throw new Error('Call ended.');
          const description = type === 'offer' ? await peer.createOffer() : await peer.createAnswer();
          await peer.setLocalDescription(description);
          await gather();
          if (closed) throw new Error('Call ended.');
          return { type, sdp: peer.localDescription.sdp };
        },
        accept: (description) => peer.setRemoteDescription(description),
        close() {
          if (closed) return;
          closed = true; cancelGather?.(); peer.close();
        },
      });
    },
  });
}
