export function safetyMonitoringRoutes(monitor) {
  const ctx=c=>({userId:c.user.id,rideId:c.match[1],sessionToken:c.token,nativeSessionId:c.nativeSessionId});
  return [
    {method:'GET',path:/^\/api\/safety-monitoring\/rides\/([a-f0-9-]{36})$/,access:'read',handle:async c=>({body:(await monitor.view(ctx(c)))})},
    {method:'POST',path:/^\/api\/safety-monitoring\/rides\/([a-f0-9-]{36})\/(preferences|signal|cancel)$/,access:'write',handle:async c=>({body:(await monitor.command(ctx(c),c.match[2],c.data,c.key))})},
    {method:'POST',path:/^\/api\/safety-monitoring\/rides\/([a-f0-9-]{36})\/heartbeat$/,access:'write',handle:async c=>({body:(await monitor.heartbeat(ctx(c)))})},
    {method:'POST',path:/^\/api\/safety-monitoring\/rides\/([a-f0-9-]{36})\/zones$/,access:'write',handle:async c=>({body:(await monitor.reportZone(ctx(c),c.data,c.key))})},
    {method:'GET',path:/^\/api\/admin\/safety-zones$/,access:'read',role:'admin',handle:async c=>({body:(await monitor.zones(c.user.id))})},
    {method:'POST',path:/^\/api\/admin\/safety-zones\/([a-f0-9-]{36})$/,access:'write',role:'admin',handle:async c=>({body:(await monitor.reviewZone(c.user.id,c.match[1],c.data))})},
  ];
}
