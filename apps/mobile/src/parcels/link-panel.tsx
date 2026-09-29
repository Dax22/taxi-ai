import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Alert, AppState, Share } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { useSession } from '../session/provider';
import { ParcelLinkController } from './link-controller';
import { useParcelFocus } from './use-focus';
import { Text } from '../ui/typography';
import { Button, Card, Notice, styles } from '../ui/components';

export function ParcelRecipientLink({ rideId }: { rideId: string }) {
  const { client, user, mode, blocked } = useSession();
  const controller = useMemo(() => new ParcelLinkController(client, rideId, randomUUID), [client, user?.id, mode, rideId]);
  const s = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const [sharing, setSharing] = useState(false), sharingRef = useRef(false);
  useParcelFocus(controller);
  const link = !blocked ? s.value?.link : null;
  const locked = blocked || s.busy || s.loading || s.stale || s.uncertain || sharing;
  function confirm(action: 'replace' | 'revoke') {
    const shown = controller.snapshot().value?.link;
    if (!shown || locked) return;
    Alert.alert(action === 'replace' ? 'Replace recipient invitation?' : 'Revoke recipient access?',
      'The existing invitation and recipient’s tracking access will stop working. This does not cancel the delivery.', [
      { text: 'Keep access', style: 'cancel' }, { text: action === 'replace' ? 'Replace invitation' : 'Revoke access', style: 'destructive', onPress: () => {
        if (AppState.currentState !== 'active' || client.account()?.id !== user?.id) return;
        if (action === 'replace') void controller.create(shown.id); else void controller.revoke(shown.id, shown.version);
      } },
    ]);
  }
  async function share() {
    if (locked || sharingRef.current) return;
    sharingRef.current = true; setSharing(true);
    const owner = user?.id;
    try {
      await controller.refresh(); controller.tick(); const latest = controller.snapshot();
      if (AppState.currentState !== 'active' || client.account()?.id !== owner || latest.stale || latest.error || latest.busy || latest.uncertain || !latest.token || !latest.value?.link?.active || latest.value.link.claimed) return;
      await Share.share({ title: 'Taxi Ai parcel invitation', message: `Your private Taxi Ai parcel invitation. Sign in and accept it only if you are the intended recipient. Do not forward this link. ${client.origin}/parcels#token=${latest.token}` });
    } catch { /* Cancelling the operating-system share menu never changes the invitation. */ }
    finally { sharingRef.current = false; setSharing(false); }
  }
  return <Card><Text style={styles.h2}>Recipient tracking</Text><Text style={styles.body}>Create a private invitation and share it only with your recipient. The first eligible account to accept it can track this parcel and see the delivery code after collection.</Text>
    <Text style={styles.small}>Nothing is sent automatically. Replace or revoke access here if you shared with the wrong person.</Text><Notice message={s.error}/>
    {link && <Text style={styles.body}>{link.active ? link.claimed ? 'Recipient accepted · account access active' : `Invitation awaiting acceptance · expires ${new Date(link.expiresAt).toLocaleString()}` : 'Recipient invitation inactive'}</Text>}
    {link?.active && !link.claimed && !s.token && <Text style={styles.small}>The invitation secret is shown only when created. Replace it to share a new link from this screen.</Text>}
    {s.value?.canCreate && <Button title={link ? 'Replace recipient invitation' : 'Create recipient invitation'} disabled={locked} busy={s.busy} onPress={() => link ? confirm('replace') : void controller.create(null)}/>}
    {!!s.token && link?.active && !link.claimed && <Button title="Share with recipient" disabled={locked} busy={sharing} onPress={() => void share()}/>}
    {link?.active && <Button title="Revoke recipient access" secondary disabled={locked} onPress={() => confirm('revoke')}/>}
    {s.value && !s.value.canCreate && <Text style={styles.small}>New invitations are available after requesting a delivery and before it ends.</Text>}
    {s.uncertain && <Button title="Retry the same invitation action" secondary busy={s.busy} disabled={blocked || sharing} onPress={() => void controller.retry()}/>}
    <Button title="Refresh recipient access" secondary busy={s.loading} disabled={s.busy || blocked || sharing} onPress={() => void controller.refresh()}/>
  </Card>;
}
