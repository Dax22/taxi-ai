export const deliveryId = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
export const deliveryKind = value => ['food','parcel'].includes(value);
export const deliveryPhase = value => ['picked_up','arrived','delivered'].includes(value);
const point = value => value && Number.isFinite(value.lat) && Number.isFinite(value.lng)
  && Math.abs(value.lat) <= 90 && Math.abs(value.lng) <= 180;

// Only coordinates and validated saved-route metrics enter the short-lived ETA job.
// Contact details, addresses, PINs and private-kitchen identity never enter notices.
export function deliveryRoute(route) {
  if (!point(route?.from) || !point(route?.to)) return null;
  return { from: {lat:route.from.lat,lng:route.from.lng}, to:{lat:route.to.lat,lng:route.to.lng},
    ...(route.source === 'osrm' && Number.isFinite(route.durationSeconds) && route.durationSeconds > 0 && route.durationSeconds <= 172800
      ? {source:'osrm',durationSeconds:Math.ceil(route.durationSeconds)} : {}) };
}

export function deliveryNotice(kind,phase,etaMinutes=null) {
  const item = kind === 'food' ? 'food' : 'package';
  if (phase === 'picked_up') return {
    title:`Kemmy · ${kind === 'food' ? 'Food' : 'Package'} picked up`,
    body:`Your ${item} has been picked up.${etaMinutes ? ` It should reach the recipient in approximately ${etaMinutes} ${etaMinutes === 1 ? 'minute' : 'minutes'}, based on the road route at pickup.` : ' A map-based delivery time is currently unavailable.'}`,
    note:etaMinutes ? 'Road-route estimate at pickup. It does not include live traffic; delays may change the arrival time.' : 'Keep following live tracking for delivery progress.',
    etaMinutes,
  };
  if (phase === 'arrived') return {title:`Kemmy · ${kind === 'food' ? 'Food' : 'Package'} has arrived`,
    body:`Your ${item} has arrived at the recipient’s location. Please get ready to receive it.`,
    note:'Share the delivery code only when the courier is there and ready to hand it over.',etaMinutes:null};
  return {title:`Kemmy · ${kind === 'food' ? 'Food' : 'Package'} delivered`,
    body:`Your ${item} has been delivered. The handover has been confirmed.`,note:'',etaMinutes:null};
}

export function projectDeliveryUpdate(row) {
  if (!row) return null;
  const {id,kind,targetId,phase,title,body,note,etaMinutes,createdAt,readAt}=row;
  return {id,kind,targetId,phase,title,body,note,etaMinutes,createdAt,readAt};
}
