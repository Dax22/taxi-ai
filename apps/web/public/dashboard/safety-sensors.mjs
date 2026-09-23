import { createSignalDetector } from '/shared/safety-monitoring.mjs';
/** Foreground only. Audio is measured in memory; no recording or audio upload. */
export function createSafetySensors({win=window,nav=navigator}={}) {
  let point=null;
  return {position:()=>point && Date.now()-point.capturedAt<30_000 ? point : null,
    async start(options,emit,onStop) {
      let stopped=false,watch=null,stream=null,audio=null,timer=null,motionSeen=false;
      const detector=createSignalDetector(s=>emit(s,point&&Date.now()-point.capturedAt<30_000?point:null));
      const motion=e=>{const a=e.accelerationIncludingGravity;if(a&&[a.x,a.y,a.z].every(Number.isFinite)){motionSeen=true;detector.motion(Math.hypot(a.x,a.y,a.z)/9.80665,Date.now());}};
      const stop=()=>{stopped=true;clearInterval(timer);if(watch!==null)nav.geolocation.clearWatch(watch);stream?.getTracks().forEach(t=>t.stop());void audio?.close().catch(()=>{});win.removeEventListener('devicemotion',motion);win.document.removeEventListener('visibilitychange',visibility);point=null;};
      const interrupted=note=>{if(stopped)return;stop();onStop(note);};
      const visibility=()=>{if(win.document.hidden)interrupted('Sensors paused because the page is hidden. Saved alert countdowns continue.');};
      try {
        if(options.crash){
          if(!win.DeviceMotionEvent)throw new Error('Motion sensing is unavailable in this browser. Use a supported phone or turn crash sensing off.');
          if(typeof win.DeviceMotionEvent.requestPermission==='function'&&await win.DeviceMotionEvent.requestPermission()!=='granted')throw new Error('Motion permission was denied.');
          win.addEventListener('devicemotion',motion);
        }
        if(!nav.geolocation)throw new Error('Location sensing is unavailable on this device.');
        watch=nav.geolocation.watchPosition(f=>{
          if(stopped)return;
          if(f.coords.accuracy>200||Date.now()-f.timestamp>30_000){point=null;detector.speed(null,Date.now());return;}
          point={lat:f.coords.latitude,lng:f.coords.longitude,accuracy:Math.max(1,f.coords.accuracy),capturedAt:Math.round(f.timestamp)};
          detector.speed(f.coords.speed,Date.now());
        },()=>interrupted('Location permission or signal was lost. Sensors paused.'),{enableHighAccuracy:true,maximumAge:0,timeout:15000});
        let analyser,buffer;
        if(options.distress){
          if(!nav.mediaDevices?.getUserMedia)throw new Error('Microphone access requires a supported browser and HTTPS.');
          stream=await nav.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});
          const Ctx=win.AudioContext||win.webkitAudioContext;audio=new Ctx();await audio.resume();
          analyser=audio.createAnalyser();analyser.fftSize=2048;audio.createMediaStreamSource(stream).connect(analyser);buffer=new Float32Array(analyser.fftSize);
          stream.getAudioTracks()[0].addEventListener('ended',()=>interrupted('Microphone stopped. Sensors paused.'));
        }
        if(stopped||win.document.hidden)throw new Error('Keep the safety screen visible to start monitoring.');
        const started=Date.now();
        timer=setInterval(()=>{
          if(options.crash&&!motionSeen&&Date.now()-started>8000){interrupted('No motion samples received. Crash sensing is unavailable on this device.');return;}
          if(analyser){if(audio.state!=='running'){interrupted('Microphone processing was interrupted. Sensors paused.');return;}
            analyser.getFloatTimeDomainData(buffer);const rms=Math.sqrt(buffer.reduce((n,x)=>n+x*x,0)/buffer.length);detector.audio(Math.max(-160,20*Math.log10(rms||1e-8)),Date.now());}
        },100);
        win.document.addEventListener('visibilitychange',visibility);return stop;
      }catch(error){stop();throw error;}
    }};
}
