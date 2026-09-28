import { APP_RELEASE, storeLink } from './app-release.mjs';
for (const platform of ['ios', 'android']) {
  const slot = document.getElementById(`download-${platform}`), url = storeLink(platform, APP_RELEASE[platform]);
  if (!slot || !url) continue;
  const link = document.createElement('a');
  link.className = 'button button-primary'; link.href = url; link.rel = 'noopener noreferrer';
  link.textContent = platform === 'ios' ? 'Download on the App Store ↗' : 'Get it on Google Play ↗';
  slot.replaceChildren(link);
}
