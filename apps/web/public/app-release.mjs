/** Set each URL only after the corresponding public store listing is available. */
export const APP_RELEASE = Object.freeze({ ios: null, android: null });

export function storeLink(platform, value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return null;
    if (platform === 'ios' && url.hostname === 'apps.apple.com'
      && /^\/(?:[a-z]{2}\/)?app\/(?:[^/]+\/)?id\d+$/.test(url.pathname) && !url.search) return url.href;
    if (platform === 'android' && url.hostname === 'play.google.com' && url.pathname === '/store/apps/details'
      && /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/i.test(url.searchParams.get('id') ?? '')
      && [...url.searchParams.keys()].length === 1) return url.href;
  } catch { /* Invalid release configuration stays unavailable. */ }
  return null;
}
