// Delivery estimates reuse the configured road router. No geodesic distance or
// assumed speed is ever presented as a map-based delivery time.
const MAX_SECONDS=48*60*60,MAX_METERS=2_500_000;
const point=value=>value && Number.isFinite(value.lat) && Number.isFinite(value.lng) && Math.abs(value.lat)<=90 && Math.abs(value.lng)<=180;
const distance=(a,b)=>{
  const radians=Math.PI/180,h=Math.sin((b.lat-a.lat)*radians/2)**2
    + Math.cos(a.lat*radians)*Math.cos(b.lat*radians)*Math.sin((b.lng-a.lng)*radians/2)**2;
  return 6_371_000*2*Math.asin(Math.sqrt(Math.min(1,h)));
};
function validRoad(raw,from,to) {
  if(!raw || raw.source === 'direct' || raw.distanceKind === 'straight_line') return false;
  const {durationSeconds:seconds,distanceMeters:meters,coordinates}=raw;
  if(!Number.isFinite(seconds) || seconds<=0 || seconds>MAX_SECONDS || !Number.isFinite(meters) || meters<0 || meters>MAX_METERS
    || !Array.isArray(coordinates) || coordinates.length<2 || coordinates.length>20_000) return false;
  const geometry=[];
  for(const pair of coordinates) {
    if(!Array.isArray(pair) || pair.length!==2 || !point({lat:pair[1],lng:pair[0]})) return false;
    geometry.push({lat:pair[1],lng:pair[0]});
  }
  if(distance(from,geometry[0])>350 || distance(to,geometry.at(-1))>350) return false;
  let roadLength=0;
  for(let i=1;i<geometry.length;i++) roadLength+=distance(geometry[i-1],geometry[i]);
  return meters>=Math.max(0,roadLength*0.8-50,distance(from,to)-700) && meters/seconds<=70;
}
const result=seconds=>({durationSeconds:Math.ceil(seconds),source:'road',trafficAware:false});

export function createDeliveryEtaProvider({mapProvider,now=Date.now,timeoutMs=2000,maxConcurrent=2,cacheMs=30_000,maxCacheEntries=256}={}) {
  for(const [value,min,max,label] of [[timeoutMs,1,8000,'timeoutMs'],[maxConcurrent,1,8,'maxConcurrent'],[cacheMs,1,60_000,'cacheMs'],[maxCacheEntries,1,1024,'maxCacheEntries']]) {
    if(!Number.isSafeInteger(value) || value<min || value>max) throw new TypeError(`Invalid delivery ETA ${label}.`);
  }
  const cache=new Map(),pending=new Map();let active=0;
  const copy=value=>value ? {...value} : null;
  async function estimate(route) {
    if(!point(route?.from) || !point(route?.to)) return null;
    // Saved parcel routes have already passed endpoint/road validation when the
    // booking quote was created. Reuse that pickup estimate without another API call.
    if(route.source === 'osrm' && Number.isFinite(route.durationSeconds) && route.durationSeconds>0 && route.durationSeconds<=MAX_SECONDS) return result(route.durationSeconds);
    if(typeof mapProvider?.route !== 'function' || mapProvider.mode === 'off') return null;
    const from={lat:route.from.lat,lng:route.from.lng},to={lat:route.to.lat,lng:route.to.lng};
    const key=`${from.lat},${from.lng}:${to.lat},${to.lng}`,saved=cache.get(key);
    if(saved && saved.until>now()) return copy(saved.value);
    if(pending.has(key)) return copy(await pending.get(key));
    if(active>=maxConcurrent) return null;
    active++;let timer,timedOut=false;
    const task=Promise.resolve().then(()=>mapProvider.route(from,to)).then(raw=>!timedOut && validRoad(raw,from,to) ? result(raw.durationSeconds) : null)
      .catch(()=>null).finally(()=>{active--;if(timedOut) pending.delete(key);});
    const timeout=new Promise(resolve=>{timer=setTimeout(()=>{timedOut=true;resolve(null);},timeoutMs);});
    const waiting=Promise.race([task,timeout]).then(value=>{
      clearTimeout(timer);
      for(const [savedKey,entry] of cache) if(entry.until<=now()) cache.delete(savedKey);
      if(cache.size>=maxCacheEntries) cache.delete(cache.keys().next().value);
      cache.set(key,{value,until:now()+(value ? cacheMs : 1500)});
      // A timed-out adapter still holds its concurrency slot until it settles.
      // Repeated requests cannot accumulate an unbounded queue behind it.
      if(!timedOut) pending.delete(key);
      return value;
    });
    pending.set(key,waiting);
    return copy(await waiting);
  }
  return Object.freeze({estimate});
}
