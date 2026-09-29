import { AppState } from 'react-native';
import { Accelerometer } from 'expo-sensors';
import { AudioModule, setAudioModeAsync } from 'expo-audio';
import type { AudioStream } from 'expo-audio';
import * as Location from 'expo-location';
import { createSignalDetector } from '../../../../packages/shared/src/safety-monitoring.mjs';
import type { SafetyPosition } from '../../../../packages/shared/src/safety-monitoring.mjs';
import type { MonitoringSensors } from '../../../../packages/shared/src/safety-monitoring-controller.mjs';

/** In-memory PCM only: no audio file, transcript, recording upload or background task. */
export function createNativeSafetySensors():MonitoringSensors {
 let point:SafetyPosition|null=null;
 return {position:()=>point&&Date.now()-point.capturedAt<30_000?point:null,
  async start(options,emit,onStop){
   let stopped=false,location:Location.LocationSubscription|undefined,motion:{remove():void}|undefined,stream:AudioStream|undefined;
   let audioSub:{remove():void}|undefined,statusSub:{remove():void}|undefined,timer:ReturnType<typeof setInterval>|undefined;
   let motionAt=Date.now(),audioAt=Date.now();
   const detector=createSignalDetector(s=>{if(!stopped)emit(s,point&&Date.now()-point.capturedAt<30_000?point:null);});
   const stop=()=>{stopped=true;clearInterval(timer);motion?.remove();location?.remove();audioSub?.remove();statusSub?.remove();stream?.stop();stream?.release();stream=undefined;app.remove();point=null;};
   const interrupt=(note:string)=>{if(stopped)return;stop();onStop(note);};
   const app=AppState.addEventListener('change',s=>{if(s!=='active')interrupt('Sensors paused while the app is not active. Saved countdowns continue.');});
   const current=()=>{if(stopped||AppState.currentState!=='active')throw new Error('Keep the safety screen open to start monitoring.');};
   try {
    if(options.crash){
     if(!await Accelerometer.isAvailableAsync())throw new Error('This device does not provide motion sensing.');current();
     if(!(await Accelerometer.requestPermissionsAsync()).granted)throw new Error('Motion permission was denied.');current();
     Accelerometer.setUpdateInterval(50);motion=Accelerometer.addListener(({x,y,z})=>{if(!stopped){motionAt=Date.now();detector.motion(Math.hypot(x,y,z),motionAt);}});
    }
    if(!(await Location.requestForegroundPermissionsAsync()).granted)throw new Error('Location permission is required for monitoring.');current();
    location=await Location.watchPositionAsync({accuracy:Location.Accuracy.High,timeInterval:1000,distanceInterval:0},fix=>{
     if(stopped)return;const c=fix.coords;
     if(c.accuracy===null||c.accuracy>200||Date.now()-fix.timestamp>30_000){point=null;detector.speed(null,Date.now());return;}
     point={lat:c.latitude,lng:c.longitude,accuracy:Math.max(1,c.accuracy),capturedAt:Math.round(fix.timestamp)};detector.speed(c.speed,Date.now());
    },()=>interrupt('Location updates stopped. Sensors paused.'));current();
    if(options.distress){
     if(!(await AudioModule.requestRecordingPermissionsAsync()).granted)throw new Error('Microphone permission was denied.');current();
     await setAudioModeAsync({allowsRecording:true,playsInSilentMode:true,shouldPlayInBackground:false});current();
     stream=new AudioModule.AudioStream({sampleRate:16000,channels:1,encoding:'float32'});
     audioSub=stream.addListener('audioStreamBuffer',buffer=>{
      if(stopped)return;const samples=new Float32Array(buffer.data);if(!samples.length)return;
      let sum=0;for(const sample of samples)sum+=sample*sample;
      audioAt=Date.now();detector.audio(Math.max(-160,20*Math.log10(Math.sqrt(sum/samples.length)||1e-8)),audioAt);
     });
     statusSub=stream.addListener('audioStreamStatus',s=>{if(!s.isStreaming)interrupt('Microphone was interrupted. Sensors paused.');});
     await stream.start();current();
    }
    timer=setInterval(()=>{if(options.crash&&Date.now()-motionAt>8000)interrupt('Motion samples stopped. Sensors paused.');
     if(options.distress&&Date.now()-audioAt>5000)interrupt('Microphone samples stopped. Sensors paused.');},1000);
    return stop;
   }catch(error){stop();throw error;}
  }};
}
