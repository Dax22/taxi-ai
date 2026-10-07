import { readFileSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createMapProvider } from '../services/api/src/infrastructure/map-provider.mjs';
export const TRACKING_RELEASE_GATES = Object.freeze([
  'legacy_invitation_transition',
  'deployed_revision', 'postgres_migration', 'android_signed_device', 'ios_signed_device',
  'locked_screen_tracking', 'short_network_recovery', 'expired_lease_restart', 'permission_revocation',
  'logout_stops_tracking', 'recipient_verification', 'forwarded_link_rejected', 'sender_recipient_live_map',
  'handover_and_tracking_shutdown', 'return_workflow', 'pending_confirmation_recovery',
  'account_email_delivery', 'contact_inbox_delivery', 'map_capacity_and_availability', 'monitoring_and_support',
]);
export function evaluateTrackingLaunch(evidence, maps, now = Date.now()) {
  const blockers = [];
  const commit = evidence?.releaseCommit;
  if (!/^[a-f0-9]{40}$/.test(commit ?? '')) blockers.push('Record the exact release commit.');
  if (maps?.mode !== 'dedicated' || !maps.enabled) blockers.push('Provision explicit production search, routing and tile capacity.');
  for (const gate of TRACKING_RELEASE_GATES) {
    const item = evidence?.checks?.[gate], at = Date.parse(item?.completedAt ?? '');
    if (item?.status !== 'passed' || item.releaseCommit !== commit || !Number.isFinite(at) || at > now || now - at > 14 * 86_400_000
      || typeof item.reviewer !== 'string' || item.reviewer.trim().length < 2
      || typeof item.reference !== 'string' || item.reference.trim().length < 5) blockers.push(`${gate}: current, reviewed evidence is missing.`);
  }
  return { ready: blockers.length === 0, blockers,
    notice: 'This validates an evidence inventory, not the truth of an attestation. Physical tests and provider provisioning are still required.' };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const filename = process.argv[2] ?? new URL('../docs/tracking-acceptance.json', import.meta.url);
    if (statSync(filename).size > 65_536) throw new Error('Acceptance file is too large.');
    const evidence = JSON.parse(readFileSync(filename, 'utf8'));
    const result = evaluateTrackingLaunch(evidence, createMapProvider({ env: process.env }).describe());
    console.log(JSON.stringify(result, null, 2));
    if (!result.ready) process.exitCode = 1;
  } catch {
    console.error('Tracking launch readiness could not be established. Check the evidence file and map configuration privately.');
    process.exitCode = 1;
  }
}
