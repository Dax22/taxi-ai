/** Explicit gateway contract. No default numbers, public emergency endpoint or silent simulator. */
export function createSafetyAlertProvider({env={},fetchImpl=fetch}={}) {
  const endpoint=env.SAFETY_ALERT_GATEWAY_URL,token=env.SAFETY_ALERT_GATEWAY_TOKEN;
  if(!endpoint && !token)return {available:false,emergencyService:null};
  const url=new URL(endpoint);
  if(url.protocol!=='https:' || url.username || url.password || url.hash || url.search || !token || token.length<24)
    throw new Error('Safety alerts require an HTTPS gateway URL and a token of at least 24 characters.');
  const emergencyService=env.SAFETY_EMERGENCY_SERVICE_NAME?.trim() || null;
  if(emergencyService && (emergencyService.length>100 || env.SAFETY_EMERGENCY_SERVICE_ENABLED!=='true'))
    throw new Error('Enable only an agreed emergency-service integration.');
  return {available:true,emergencyService,async send(payload) {
    const response=await fetchImpl(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(8000),
      headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`,'Idempotency-Key':payload.idempotencyKey},body:JSON.stringify(payload)});
    if(!response.ok)throw new Error('Safety gateway did not accept the alert.');
    const reader=response.body?.getReader();let bytes=0,chunks=[];
    if(!reader)throw new Error('Missing safety gateway receipt.');
    while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>4096){await reader.cancel();throw new Error('Oversized gateway receipt.');}chunks.push(value);}
    const data=JSON.parse(Buffer.concat(chunks).toString());
    if(data.accepted!==true || typeof data.reference!=='string' || !/^[A-Za-z0-9_-]{1,128}$/.test(data.reference))throw new Error('Invalid safety gateway receipt.');
    return {reference:data.reference};
  }};
}
