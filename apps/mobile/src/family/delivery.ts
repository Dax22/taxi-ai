import type { FamilyDelivery } from '../../../../packages/shared/src/family.mjs';

export function familyDeliveryLabel(delivery?: FamilyDelivery) {
  if (!delivery || delivery.status === 'saved') return 'Saved in the Family Safety inbox';
  switch (delivery.status) {
    case 'queued': return 'Phone alert queued';
    case 'provider_accepted': return 'Accepted by notification service';
    case 'delivered': return 'Phone alert delivery confirmed';
    case 'failed': return 'Phone alert failed; update remains in the inbox';
    case 'suppressed': return 'Phone alert not sent';
  }
}
