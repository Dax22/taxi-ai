// Expo is optional. No provider request is made until configured and a device opts in.
export function createPushProvider({ env = {}, fetchImpl = fetch } = {}) {
  const enabled = env.TAXI_AI_PUSH_ENABLED === 'true', projectId = env.TAXI_AI_EXPO_PROJECT_ID ?? null;
  if (enabled && !/^[a-f0-9-]{36}$/.test(projectId ?? '')) throw new Error('Configure TAXI_AI_EXPO_PROJECT_ID before enabling push.');
  async function post(path,data) {
    const response = await fetchImpl(`https://exp.host/--/api/v2/push/${path}`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
      headers: { 'Content-Type': 'application/json', ...(env.TAXI_AI_EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${env.TAXI_AI_EXPO_ACCESS_TOKEN}` } : {}) }, body: JSON.stringify(data) });
    if (!response.ok) return { status: response.status === 429 || response.status >= 500 ? 'retry' : 'error' };
    return response.json();
  }
  function error(value) { return { status: value?.details?.error === 'DeviceNotRegistered' ? 'unregistered'
    : value?.details?.error === 'MessageRateExceeded' ? 'retry' : 'error' }; }
  return Object.freeze({ enabled, projectId: enabled ? projectId : null,
    async send({ token, notificationId, arrivalBody, familyEventId, announcementId, announcementTitle, announcementBody, announcementPriority,
      deliveryUpdateId, deliveryTitle, deliveryBody }) {
      if (!enabled) return { status: 'error' };
      const family = familyEventId !== undefined, announcement = announcementId !== undefined, delivery = deliveryUpdateId !== undefined;
      if (delivery) {
        if (family || announcement || notificationId !== undefined
          || typeof deliveryUpdateId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(deliveryUpdateId)
          || typeof deliveryTitle !== 'string' || deliveryTitle.length < 2 || deliveryTitle.length > 160
          || typeof deliveryBody !== 'string' || deliveryBody.length < 2 || deliveryBody.length > 1000) return { status: 'error' };
      } else if (announcement) {
        if (typeof announcementId !== 'string' || !/^[a-f0-9-]{36}$/.test(announcementId)
          || typeof announcementTitle !== 'string' || announcementTitle.length < 2 || announcementTitle.length > 80
          || typeof announcementBody !== 'string' || announcementBody.length < 2 || announcementBody.length > 500
          || !['normal','important','critical'].includes(announcementPriority)) return { status:'error' };
      } else if (family ? typeof familyEventId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(familyEventId)
        : !Number.isSafeInteger(notificationId) || notificationId < 1) return { status:'error' };
      const arrival = !delivery && !family && !announcement && typeof arrivalBody === 'string' && arrivalBody.length > 0 && arrivalBody.length <= 500;
      const result = await post('send',{ to: token,
        title: delivery ? deliveryTitle : announcement ? `Taxi Ai · ${announcementTitle}` : arrival ? 'Taxi Ai · Driver has arrived' : 'Taxi Ai',
        body: delivery ? deliveryBody : announcement ? announcementBody : family ? 'You have a Family Safety update. Open Taxi Ai to view it.'
          : arrival ? arrivalBody : 'You have a new journey update. Open Taxi Ai to view it.',
        data: delivery ? { kind: 'delivery', deliveryUpdateId } : announcement ? {kind:'announcement',announcementId}
          : family ? {kind:'family',eventId:familyEventId} : { notificationId },
        sound: 'default', channelId: announcement ? 'announcements' : 'journeys',
        ttl: announcement ? (announcementPriority==='critical'?86400:3600) : 300 });
      if (!result.data) return { status: result.status ?? 'retry' };
      return result.data.status === 'ok' && typeof result.data.id === 'string' ? { status: 'ticket', ticket: result.data.id } : error(result.data);
    },
    async receipt(ticket) {
      if (!enabled) return { status: 'error' };
      const result = await post('getReceipts',{ ids: [ticket] }), receipt = result.data?.[ticket];
      return receipt?.status === 'ok' ? { status: 'ok' } : receipt ? error(receipt) : { status: result.status ?? 'retry' };
    },
  });
}
