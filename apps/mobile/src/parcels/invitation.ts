/** Accept only an opaque token or a link from this app's configured backend. Never persist it. */
export function parcelInvitationToken(value: string, origin: string) {
  const input = value.trim();
  if (/^[a-f0-9]{64}$/.test(input)) return input;
  let url: URL;
  try { url = new URL(input); } catch { throw new Error('Paste the private parcel invitation from your sender.'); }
  if (url.origin !== new URL(origin).origin || url.pathname !== '/parcels' || url.username || url.password || url.search) {
    throw new Error('Use a parcel invitation from this Taxi Ai service.');
  }
  const token = url.hash.startsWith('#token=') ? url.hash.slice(7) : '';
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('This parcel invitation is incomplete. Ask the sender for a new link.');
  return token;
}
