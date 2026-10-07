import { mediaDevices, RTCPeerConnection, RTCSessionDescription, type MediaStream } from 'react-native-webrtc';
export type NativeCallStream=MediaStream;
export interface NativeCallTransport{connected():boolean;describe(type:'offer'|'answer',remote?:{type:'offer'|'answer';sdp:string}|null):Promise<{type:'offer'|'answer';sdp:string}>;accept(remote:{type:'offer'|'answer';sdp:string}):Promise<void>;mute(value:boolean):void;close():void}
export async function acquireCallAudio():Promise<NativeCallStream>{return await mediaDevices.getUserMedia({audio:true,video:false}) as MediaStream;}
export function stopCallAudio(stream:NativeCallStream|null){stream?.getTracks().forEach(track=>track.stop());}
function waitForIce(peer:RTCPeerConnection){if(peer.iceGatheringState==='complete')return Promise.resolve();return new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>{cleanup();reject(new Error('Audio network setup timed out.'));},10000);const changed=()=>{if(peer.iceGatheringState==='complete'){cleanup();resolve();}};const cleanup=()=>{clearTimeout(timer);if(peer.onicegatheringstatechange===changed as any)peer.onicegatheringstatechange=null;};peer.onicegatheringstatechange=changed as any;});}
export function createNativeCallTransport(configuration:any,stream:NativeCallStream,onState:(state:string)=>void):NativeCallTransport{
 const peer=new RTCPeerConnection(configuration as any);let closed=false;
 for(const track of stream.getAudioTracks())peer.addTrack(track,stream);
 const changed=()=>{if(!closed)onState(peer.connectionState)};peer.onconnectionstatechange=changed as any;
 return{connected:()=>peer.connectionState==='connected',async describe(type,remote=null){if(remote)await peer.setRemoteDescription(new RTCSessionDescription(remote as any));const d=type==='offer'?await peer.createOffer():await peer.createAnswer();await peer.setLocalDescription(d);await waitForIce(peer);const local=peer.localDescription;if(!local?.sdp)throw new Error('Audio negotiation failed.');return{type,sdp:local.sdp};},
  accept:async(remote)=>{await peer.setRemoteDescription(new RTCSessionDescription(remote as any));},mute(value){for(const track of stream.getAudioTracks())track.enabled=!value;},close(){if(closed)return;closed=true;peer.onconnectionstatechange=null;peer.onicegatheringstatechange=null;peer.close();}};
}
