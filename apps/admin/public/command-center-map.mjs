import { el } from './ui.mjs';

/** One explicitly opened, audited transaction. No off-duty tracking or invented history. */
export function renderLiveMap(data) {
 const container=el('section',null,'transaction-map',{'aria-label':'Latest reported transaction location'}),p=data.position;
 if(!p||!Number.isFinite(p.lat)||!Number.isFinite(p.lng)) {container.append(el('p','No shared location is available. No marker has been invented.'));return container;}
 container.append(el('p',`Latitude ${p.lat.toFixed(5)}; longitude ${p.lng.toFixed(5)}. ${data.status==='stale'?'Last known, not live.':'Fresh at the displayed observation time; refresh to recheck.'}`));
 if(!data.map?.enabled||!data.map.tiles){container.append(el('p','Online street tiles are unavailable; the reported coordinates remain visible.'));return container;}
 const button=el('button','Load street map from configured provider','button secondary',{type:'button'});
 container.append(el('p','Loading street tiles sends the displayed map area to the configured map provider. It does not request this computer\'s location.','definition-note'),button);
 button.addEventListener('click',()=>{
  button.disabled=true;
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 768 768');svg.setAttribute('role','img');svg.setAttribute('aria-label','Map of latest reported courier position');
  const zoom=15,n=2**zoom,x=(p.lng+180)/360*n,s=Math.sin(p.lat*Math.PI/180),y=(0.5-Math.log((1+s)/(1-s))/(4*Math.PI))*n;
  const left=Math.floor(x)-1,top=Math.floor(y)-1;
  for(let dy=0;dy<3;dy++)for(let dx=0;dx<3;dx++){
   const image=document.createElementNS(ns,'image');image.setAttribute('x',String(dx*256));image.setAttribute('y',String(dy*256));image.setAttribute('width','256');image.setAttribute('height','256');
   const url=data.map.tiles.replace('{z}',String(zoom)).replace('{x}',String(left+dx)).replace('{y}',String(top+dy));
   image.setAttribute('href',url);image.addEventListener('error',()=>{container.append(el('p','Some street tiles could not load. Coordinates remain available.','definition-note'));});svg.append(image);
  }
  const marker=document.createElementNS(ns,'circle');marker.setAttribute('cx',String((x-left)*256));marker.setAttribute('cy',String((y-top)*256));marker.setAttribute('r','9');marker.setAttribute('class',data.status==='stale'?'location-marker stale':'location-marker');svg.append(marker);container.append(svg,el('p','Map data © OpenStreetMap contributors. Device-reported positions may be inaccurate.','definition-note'));button.hidden=true;
 },{once:true});return container;
}
