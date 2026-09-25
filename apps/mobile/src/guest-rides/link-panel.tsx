import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Alert, AppState, Share } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { createGuestRideController } from '../../../../packages/shared/src/guest-rides-controller.mjs';
import { useSession } from '../session/provider';
import { Button, Card, Loading, Notice, Pill, styles } from '../ui/components';
import { Text } from '../ui/typography';

/** Only render this panel for the customer's own journey booked for an adult guest. */
export function GuestRideLink({ rideId }: { rideId: string }) {
  const { client, user, blocked } = useSession();
  const controller = useMemo(() => createGuestRideController({
    makeKey: randomUUID,
    api: {
      request: path => client.guestRides(path),
      command: (path, data, key) => client.guestRides(path, data, key),
    },
  }), [client, user?.id, rideId]);
  const s = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const [error, setError] = useState(''), [sharing, setSharing] = useState(false);
  const visible = useRef(false), generation = useRef(0), sharingRef = useRef(false);

  useFocusEffect(useCallback(() => {
    const owner = user?.id;
    function clear() {
      visible.current = false;
      generation.current++;
      sharingRef.current = false;
      setSharing(false);
      setError('');
      controller.pause();
    }
    if (!owner || blocked || AppState.currentState !== 'active') {
      clear();
      if (!owner) void controller.context(null);
      return;
    }
    visible.current = true;
    generation.current++;
    void controller.context({ userId: owner, rideId });
    const background = AppState.addEventListener('change', next => {
      if (next !== 'active') { clear(); return; }
      // SessionProvider normally reactivates the focus effect after verification.
      // Recheck here as well if React batches its blocked-state transitions.
      const epoch = ++generation.current;
      void client.session().then(() => {
        if (generation.current !== epoch || AppState.currentState !== 'active' || client.account()?.id !== owner) return;
        visible.current = true;
        void controller.context({ userId: owner, rideId });
      }).catch(() => {
        if (generation.current === epoch && AppState.currentState === 'active') {
          setError('Your session could not be confirmed. Reopen the journey after reconnecting.');
        }
      });
    });
    const account = client.subscribe(next => {
      if (next?.id !== owner) {
        clear();
        void controller.context(null);
      }
    });
    const clock = setInterval(() => controller.tick(), 1000);
    const refresh = client.subscribeChanges(() => {
      const latest = controller.snapshot();
      if (visible.current && !latest.pending && !latest.loading && !latest.uncertain && !sharingRef.current) {
        return controller.load();
      }
    });
    return () => {
      clear();
      background.remove();
      account();
      clearInterval(clock);
      refresh();
    };
  }, [controller, client, user?.id, rideId, blocked]));

  function current(epoch = generation.current, owner = user?.id) {
    return Boolean(owner && visible.current && !blocked && generation.current === epoch
      && AppState.currentState === 'active' && client.account()?.id === owner);
  }
  function available() {
    const latest = controller.snapshot();
    return current() && !sharingRef.current && !latest.pending && !latest.loading && !latest.uncertain
      && latest.value?.rideId === rideId;
  }
  function confirm(action: 'replace' | 'revoke') {
    if (!available()) return;
    const shown = controller.snapshot().value?.link;
    if (!shown) return;
    const epoch = generation.current, owner = user?.id;
    Alert.alert(action === 'replace' ? 'Replace guest link?' : 'Revoke guest link?',
      action === 'replace'
        ? 'The previous link will stop working. You can choose who receives the new link, which includes the pickup code.'
        : 'Your passenger will lose access through this link. This does not cancel the ride.', [
        { text: 'Back', style: 'cancel' },
        { text: action === 'replace' ? 'Replace link' : 'Revoke link', style: action === 'revoke' ? 'destructive' : 'default', onPress: () => {
          if (!current(epoch, owner) || !available()) return;
          const latest = controller.snapshot().value;
          if (latest?.link?.id !== shown.id || latest.link.version !== shown.version) {
            setError('This link changed. Review its latest status before continuing.');
            return;
          }
          if (action === 'replace' ? !latest.canCreate : !latest.link.active) return;
          setError('');
          void controller[action]();
        } },
      ]);
  }
  async function share() {
    if (!available()) return;
    const epoch = generation.current, owner = user?.id;
    sharingRef.current = true;
    setSharing(true);
    setError('');
    try {
      await controller.load();
      controller.tick();
      if (!current(epoch, owner)) return;
      const latest = controller.snapshot();
      if (latest.loading || latest.pending || latest.uncertain || latest.error || !latest.token
        || latest.value?.rideId !== rideId || !latest.value.link?.active) {
        setError('The guest link could not be confirmed. Refresh its status before sharing.');
        return;
      }
      await Share.share({
        title: 'Private Taxi Ai guest trip',
        message: `Private Taxi Ai guest-trip link for the adult passenger I booked for. It includes the trip details and pickup code. Keep it private and do not forward it. ${client.origin}/guest-trip#${latest.token}`,
      });
    } catch {
      if (current(epoch, owner)) setError('Could not open sharing. The link was not confirmed sent.');
    } finally {
      if (current(epoch, owner)) {
        sharingRef.current = false;
        setSharing(false);
      }
    }
  }

  const value = !blocked && user ? s.value : null, link = value?.link;
  const locked = blocked || !user || s.loading || s.pending || s.uncertain || sharing || !value;
  return <Card>
    <Text style={styles.h2}>Your guest’s private trip link</Text>
    <Text style={styles.body}>Share this only with the adult friend or family member you booked for. Anyone with the link can view the trip and pickup code. Your passenger should give the code to the driver only after checking the correct driver and vehicle.</Text>
    <Text style={styles.small}>You choose the recipient using your phone’s share menu. Nothing is sent automatically.</Text>
    <Notice message={s.error || error}/>
    {s.loading && !value && <Loading/>}
    {link && <>
      <Pill>{link.active ? 'GUEST LINK ACTIVE' : 'GUEST LINK INACTIVE'}</Pill>
      <Text style={styles.small}>Link expires {new Date(link.expiresAt).toLocaleString()}.</Text>
      {link.active && !s.token && <Text style={styles.body}>To share a link from this screen again, create a replacement. The previous link will stop working.</Text>}
    </>}
    {value?.canCreate && <Button title={link ? 'Replace guest link' : 'Create guest link'} disabled={locked} busy={s.pending}
      secondary={Boolean(link)} onPress={() => {
        if (link) { confirm('replace'); return; }
        if (!available() || !controller.snapshot().value?.canCreate || controller.snapshot().value?.link) return;
        setError('');
        void controller.create();
      }}/>
    }
    {s.token && link?.active && <Button title="Choose who to share with" disabled={locked || Boolean(s.error)} busy={sharing} onPress={() => void share()}/>}
    {link?.active && <Button title="Revoke guest link" secondary disabled={locked} onPress={() => confirm('revoke')}/>}
    {value && !value.canCreate && <Text style={styles.body}>Guest links are available after booking confirmation and while the trip is active.</Text>}
    {s.uncertain && <>
      <Notice message="The last link action was interrupted. Resolve that same action before creating, revoking or sharing a link."/>
      <Button title="Retry the same guest-link action" disabled={blocked || !user || s.loading || sharing} busy={s.pending}
        onPress={() => { if (current() && !sharingRef.current) { setError(''); void controller.retry(); } }}/>
    </>}
    <Button title="Refresh guest link" secondary busy={s.loading} disabled={blocked || !user || s.pending || sharing}
      onPress={() => { if (current() && !sharingRef.current) { setError(''); void controller.load(); } }}/>
  </Card>;
}
