import { check } from '../shared/errors.mjs';
// Native clients receive participant-owned data, never reviewer IDs or snapshots.
const incident = (i) => ({ id:i.id, kind:i.kind, status:i.status, note:i.note, createdAt:i.createdAt, updatedAt:i.updatedAt,
  notifications:i.notifications.map(n=>({id:n.id,recipientName:n.recipientName,status:n.status,mode:n.mode})) });
export function mobileSafety({ safety, session, path, write, data, key }) {
  const userId = session.user.id;
  if (!write && path === '/safety/contacts') return { contacts:safety.contacts(userId).contacts };
  const trip = path.match(/^\/safety\/rides\/([a-f0-9-]{36})$/);
  if (!write && trip) {
    const r=safety.trip(userId,trip[1]);
    return {rideId:r.rideId,canRaise:r.canRaise,share:r.share,location:r.location,incidents:r.incidents.map(incident)};
  }
  let action, id=null;
  if (path === '/safety/contacts') action='contact.add';
  const contact=path.match(/^\/safety\/contacts\/([a-f0-9-]{36})\/(edit|remove)$/);
  const ride=path.match(/^\/safety\/rides\/([a-f0-9-]{36})\/(incidents|links)$/);
  const link=path.match(/^\/safety\/links\/([a-f0-9-]{36})\/revoke$/);
  if(contact){id=contact[1];action=`contact.${contact[2]}`;}
  if(ride){id=ride[1];action=ride[2]==='incidents'?'incident.create':'link.create';}
  if(link){id=link[1];action='link.revoke';}
  check(write && action,'NOT_FOUND','Safety endpoint not found.');
  const r=safety.command({userId,nativeSessionId:session.id,action,id,data,key});
  return {replayed:r.replayed,...(r.contact!==undefined?{contact:r.contact}:{}),...(r.incident?{incident:incident(r.incident)}:{}),
    ...(r.share!==undefined?{share:r.share,token:r.token}:{} )};
}
