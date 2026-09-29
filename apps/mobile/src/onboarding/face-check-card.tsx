import { useEffect, useState } from 'react';
import { Switch, View } from 'react-native';
import type { DriverOnboarding } from '../../../../packages/shared/src/mobile-contracts.mjs';
import { DRIVER_FACE_CONSENT, driverFacePresentation } from '../../../../packages/shared/src/driver-face-check.mjs';
import { Button, Card, Pill, styles } from '../ui/components';
import { Text } from '../ui/typography';
import { canCompareDriverFace } from './face-check';

export function FaceCheckCard({ application, onCompare, disabled, pending }: { application: DriverOnboarding; onCompare(consent: boolean): void; disabled: boolean; pending: boolean }) {
  const [consent, setConsent] = useState(false);
  const [now, setNow] = useState(Date.now());
  const check = application.faceCheck;
  const presentation = driverFacePresentation(check);
  useEffect(() => { setConsent(false); }, [application.driverId, application.version, check?.status]);
  useEffect(() => {
    setNow(Date.now());
    if (!check?.retryAfter || check.retryAfter <= Date.now()) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(check.retryAfter - Date.now() + 50, 2_147_483_647));
    return () => clearTimeout(timer);
  }, [check?.retryAfter]);
  const editable = ['draft', 'changes_requested', 'rejected'].includes(application.status);
  const complete = ['profile_photo', 'driving_licence'].every((kind) => application.documents.some((doc) => doc.kind === kind));
  const waiting = !!check?.retryAfter && check.retryAfter > now;
  const locked = disabled || pending || !editable || !check?.available || !complete || check.status === 'pending' || check.status === 'matched' || waiting;
  return <Card><Pill>AUTOMATIC FACE COMPARISON</Pill><Text style={styles.h2}>{presentation.title}</Text>
    <Text accessibilityLiveRegion="polite" style={styles.body}>{presentation.detail}</Text>
    <Text style={styles.small}>This compares two photos. It does not confirm liveness, licence authenticity or licence validity, and does not approve you to drive.</Text>
    {!complete && <Text style={styles.small}>Save your driver selfie and the front of your driving licence in Documents first.</Text>}
    {editable && check?.status !== 'matched' && <>
      <View style={styles.row}><Switch value={consent} onValueChange={setConsent} disabled={locked}
        accessibilityLabel={DRIVER_FACE_CONSENT}/>
        <Text style={[styles.body, { flex: 1, minWidth: 180 }]}>{DRIVER_FACE_CONSENT}</Text></View>
      {waiting && <Text style={styles.small}>You can try again after {new Date(check!.retryAfter!).toLocaleString()}.</Text>}
      <Button title="Compare my face" onPress={() => onCompare(consent)} disabled={!canCompareDriverFace(application, { consent, blocked: disabled || pending, now })} busy={pending}/>
    </>}
  </Card>;
}
