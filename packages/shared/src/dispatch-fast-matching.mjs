/**
 * Faster exact min-cost / maximum-cardinality matching for the existing
 * 32-driver, 32-ride, 512-edge dispatch budget.
 * Input edges must already be eligibility/GPS/radius screened.
 *
 * Shortest augmenting paths use a bounded circular relaxation queue in the
 * residual graph. This avoids repeated full Bellman-Ford scans of every
 * vertex and has no external I/O, model dependency, or hidden driver ranking.
 * A strict work limit allows the caller to fall back to the legacy solver.
 */
export function allocateFastMatching(edges,{maxDrivers=32,maxRides=32,maxEdges=512}={}){
 if(!Array.isArray(edges)||!Number.isSafeInteger(maxEdges)||maxEdges<1||maxEdges>8192||edges.length>maxEdges)
  throw new TypeError('Graph too large');
 for(const edge of edges)if(!edge||typeof edge.driverId!=='string'||typeof edge.rideId!=='string'
  ||!edge.driverId.length||!edge.rideId.length
  ||!Number.isSafeInteger(edge.cost)||Math.abs(edge.cost)>100_000_000)
  throw new TypeError('Invalid dispatch edge');
 if(!edges.length)return [];
 const sort=(a,b)=>a<b?-1:a>b?1:0;
 const drivers=[...new Set(edges.map(e=>e.driverId))].sort(sort);
 const rides=[...new Set(edges.map(e=>e.rideId))].sort(sort);
 if(drivers.length>maxDrivers||rides.length>maxRides)throw new RangeError('Graph too large');
 const sink=drivers.length+rides.length+1,n=sink+1;
 const dn=new Map(drivers.map((id,i)=>[id,i+1]));
 const rn=new Map(rides.map((id,i)=>[id,drivers.length+i+1]));
 const graph=Array.from({length:n},()=>[]);
 function add(a,b,cost){
  const f={to:b,cost,cap:1,rev:graph[b].length};
  const r={to:a,cost:-cost,cap:0,rev:graph[a].length};
  graph[a].push(f);graph[b].push(r);return f;
 }
 for(const id of drivers)add(0,dn.get(id),0);
 const links=edges.map(edge=>({edge,link:add(dn.get(edge.driverId),rn.get(edge.rideId),edge.cost)}));
 for(const id of rides)add(rn.get(id),sink,0);
 const queue=new Int16Array(n+1);
 for(let flow=0;flow<Math.min(drivers.length,rides.length);flow++){
  const dist=new Float64Array(n);dist.fill(Infinity);
  const prevNode=new Int16Array(n);prevNode.fill(-1);
  const prevEdge=new Int16Array(n),inQueue=new Uint8Array(n);
  let head=0,tail=1,size=1,relaxations=0;
  queue[0]=0;dist[0]=0;inQueue[0]=1;
  while(size>0){
   const u=queue[head];head=(head+1)%queue.length;size--;inQueue[u]=0;
   for(let i=0;i<graph[u].length;i++){
    const e=graph[u][i];if(!e.cap)continue;
    const next=dist[u]+e.cost;
    if(next<dist[e.to]){
     dist[e.to]=next;prevNode[e.to]=u;prevEdge[e.to]=i;
     if(!inQueue[e.to]){
      if(size>=n)throw new Error('Shortest-path queue overflow');
      queue[tail]=e.to;tail=(tail+1)%queue.length;size++;inQueue[e.to]=1;
     }
     if(++relaxations>n*maxEdges*4)throw new Error('Excessive shortest-path work');
    }
   }
  }
  if(prevNode[sink]<0)break;
  for(let node=sink;node!==0;){
   const from=prevNode[node],e=graph[from][prevEdge[node]];
   e.cap--;graph[node][e.rev].cap++;node=from;
  }
 }
 return links.filter(x=>x.link.cap===0).map(x=>x.edge);
}
