import { Image, View } from 'react-native';
import { Text } from '../ui/typography';
import { DRIVER_DOCUMENTS } from '../../../../packages/shared/src/driver-onboarding.mjs';
import type { DocumentKind, DriverOnboarding } from '../../../../packages/shared/src/mobile-contracts.mjs';
import type { DriverFile } from './files';
import { Button, Card, Field, Pill, styles } from '../ui/components';

export function DocumentsStep({ application, kind, onKind, expiresOn, onExpiry, file, onChoose, onClear, onUpload, onRemove, onContinue, disabled, pending }:
  { application: DriverOnboarding; kind: DocumentKind; onKind(value: DocumentKind): void; expiresOn: string; onExpiry(value: string): void;
    file: DriverFile | null; onChoose(): void; onClear(): void; onUpload(): void; onRemove(id: string): void; onContinue(): void; disabled: boolean; pending: boolean }) {
  const ready = application.details && !application.eligibility.missing.length && !application.eligibility.expired.length;
  return <><Card><Pill>{`${application.documents.length} OF 5 DOCUMENTS ADDED`}</Pill><Text style={styles.h2}>A few checks. A better journey.</Text>
    <Text style={styles.body}>Add clear PNG or JPEG images up to 2 MiB each. Include the car and its readable number plate in the vehicle photo.</Text>
    <Text style={styles.small}>These uploads are private to you and the review team. They are not customer-facing vehicle photos. Expiry dates use Abuja time.</Text>
  </Card><Card>{(Object.entries(DRIVER_DOCUMENTS) as [DocumentKind, { label: string; expires: boolean }][]).map(([key,spec]) => {
    const doc = application.documents.find((d) => d.kind === key), expired = application.eligibility.expired.includes(key);
    return <View key={key} style={[styles.stack,{ paddingVertical: 12 }]}><Text style={styles.body}>{spec.label}</Text>
      <Text style={styles.small}>{doc ? `${expired ? 'Expired · ' : 'Added · '}${doc.name}${doc.expiresOn ? ` · expires ${doc.expiresOn}` : ''}` : 'Still needed'}</Text>
      <View style={styles.row}><Button title={kind === key ? `Selected: ${spec.label}` : doc ? `Replace ${spec.label.toLowerCase()}` : `Add ${spec.label.toLowerCase()}`} secondary={kind !== key} disabled={disabled} onPress={() => onKind(key)}/>
        {doc && <Button title="Remove" secondary disabled={disabled} onPress={() => onRemove(doc.id)}/>}</View></View>;
  })}</Card><Card><Text style={styles.h2}>{DRIVER_DOCUMENTS[kind].label}</Text>
    {DRIVER_DOCUMENTS[kind].expires && <Field label="Expiry date (YYYY-MM-DD)" value={expiresOn} onChangeText={onExpiry} placeholder="2027-12-31" maxLength={10} keyboardType="numbers-and-punctuation" editable={!disabled}/>}
    {file && <><Image source={{ uri: `data:${file.mimeType};base64,${file.base64}` }} style={{ width: '100%', height: 220, borderRadius: 14, backgroundColor: '#F1F3EF' }} resizeMode="contain" accessibilityLabel={`Selected ${DRIVER_DOCUMENTS[kind].label.toLowerCase()}`}/>
      <Text style={styles.small}>{file.name} · ready to upload</Text><Button title="Clear selected image" secondary onPress={onClear} disabled={disabled}/></>}
    <Button title={file ? 'Choose a different image' : 'Choose image from this device'} secondary onPress={onChoose} disabled={disabled} busy={pending && !file}/>
    <Button title={application.documents.some((d) => d.kind === kind) ? 'Replace saved document' : 'Upload document'} onPress={onUpload} disabled={disabled || !file} busy={pending && !!file}/>
  </Card><Button title="Continue to review" onPress={onContinue} disabled={!ready || disabled}/></>;
}
