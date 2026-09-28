import { View } from 'react-native';
import { Text } from '../ui/typography';
import { DRIVER_DOCUMENTS, DRIVER_APPLICATION_LABELS } from '../../../../packages/shared/src/driver-onboarding.mjs';
import type { DriverOnboarding, DocumentKind } from '../../../../packages/shared/src/mobile-contracts.mjs';
import { Button, Card, Pill, styles } from '../ui/components';
import { VehicleCard } from '../ui/vehicle-card';
import { FaceCheckCard } from './face-check-card';
import { driverFaceCheckComplete } from '../../../../packages/shared/src/driver-face-check.mjs';

export function ReviewStep({ application: app, onSubmit, onReopen, onCompareFace, pending, disabled }: { application: DriverOnboarding; onSubmit(): void; onReopen(): void; onCompareFace(consent: boolean): void; pending: boolean; disabled: boolean }) {
  const editable = ['draft','changes_requested','rejected'].includes(app.status);
  const ready = app.details && !app.eligibility.missing.length && !app.eligibility.expired.length && driverFaceCheckComplete(app.faceCheck);
  return <><Card><Pill>{DRIVER_APPLICATION_LABELS[app.status].toUpperCase()}</Pill><Text style={styles.h2}>{app.status === 'submitted' ? 'You’re in the review queue.' : app.eligibility.eligible ? 'Your vehicle is approved.' : 'Check every detail.'}</Text>
    <Text style={styles.body}>{app.status === 'submitted' ? 'The review team will inspect your documents. Check back here for the result.' : app.eligibility.eligible ? 'Your documents and manual review are current.' : 'An approved application and current documents are required before taking rides.'}</Text>
    {app.reviewReason && <Text style={styles.body}>Last review: {app.reviewReason}</Text>}
    {!!app.eligibility.expired.length && <Text style={styles.body}>Renew: {app.eligibility.expired.map((k) => DRIVER_DOCUMENTS[k as DocumentKind]?.label ?? k).join(', ')}.</Text>}
  </Card><VehicleCard vehicle={app.details?.vehicle ?? app.vehicle} label={app.status === 'approved' ? 'APPROVED VEHICLE DETAILS' : 'VEHICLE DETAILS FOR REVIEW'}/>
    {app.details && <Card><Text style={styles.h2}>Your private details</Text><Text style={styles.body}>{app.details.legalName}</Text><Text style={styles.body}>{app.details.phone}</Text><Text style={styles.body}>Licence: {app.details.licenceNumber}</Text></Card>}
    <Card><Text style={styles.h2}>Your documents</Text>{Object.entries(DRIVER_DOCUMENTS).map(([kind,spec]) => {
      const doc = app.documents.find((d) => d.kind === kind);
      return <View key={kind} style={{ gap: 4, paddingVertical: 7 }}><Text style={styles.body}>{spec.label}</Text><Text style={styles.small}>{doc ? `${doc.name}${doc.expiresOn ? ` · expires ${doc.expiresOn}` : ''}` : 'Still needed'}</Text></View>;
    })}</Card>
    <FaceCheckCard application={app} onCompare={onCompareFace} disabled={disabled} pending={pending}/>
    {editable ? <><Text style={styles.small}>By submitting, you confirm these details describe the vehicle you will use. An administrator must record the document review before approval.</Text>
      <Button title="Confirm details and submit for review" onPress={onSubmit} busy={pending} disabled={disabled || !ready}/></>
      : <><Text style={styles.small}>Changed your car, colour or number plate? Update the details and replacement vehicle documents, then submit for review. New jobs stay paused until approval. Finish assigned work first.</Text><Button title="Edit / change vehicle" secondary onPress={onReopen} disabled={disabled || app.busy} busy={pending}/></>}
  </>;
}
