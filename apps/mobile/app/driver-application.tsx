import { Alert, View } from 'react-native';
import { Text } from '../src/ui/typography';
import { useLocalSearchParams } from 'expo-router';
import { useSession } from '../src/session/provider';
import { useDriverOnboarding } from '../src/onboarding/use-onboarding';
import { DetailsStep } from '../src/onboarding/details-step';
import { DocumentsStep } from '../src/onboarding/documents-step';
import { ReviewStep } from '../src/onboarding/review-step';
import { Button, Heading, Loading, Notice, Pill, Screen, styles } from '../src/ui/components';

function Application() {
  const { section } = useLocalSearchParams<{ section?: string }>();
  const f = useDriverOnboarding(section === 'vehicle');
  const reload = () => f.dirty || f.file ? Alert.alert('Load saved application?', 'Unsaved details and the selected image will be cleared.', [
    { text: 'Keep editing', style: 'cancel' }, { text: 'Load saved details', onPress: () => void f.reload() },
  ]) : void f.reload();
  const remove = (id: string) => Alert.alert('Remove this document?', 'You will need to upload a replacement before submitting.', [
    { text: 'Keep document', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => void f.change('remove',id) },
  ]);
  const reopen = () => Alert.alert('Edit / change vehicle?', 'This pauses new jobs until approval. Changing vehicle details removes its current vehicle document and vehicle photo so you can upload replacements. Your driver photo and licence stay in the application.', [
    { text: 'Keep current application', style: 'cancel' }, { text: 'Continue to edit vehicle', onPress: () => void f.change('reopen') },
  ]);
  return <Screen key={f.step}><Pill>DRIVE WITH TAXI AI</Pill><Heading title="Your vehicle. Your next chapter." subtitle="A guided application, saved to the same account on your phone and the web."/>
    <Text style={styles.small}>Development preview · use fictional details and test documents.</Text><Notice message={f.error}/>
    {!!f.notice && <Text accessibilityLiveRegion="polite" style={styles.body}>{f.notice}</Text>}
    {f.loading ? <Loading/> : <>
      {f.application && !['draft','changes_requested','rejected'].includes(f.application.status) && <Button title="Edit / change vehicle" onPress={reopen} disabled={f.pending || f.stale || f.application.busy}/>}
      <View style={styles.row}>{['1 · Details','2 · Documents','3 · Review'].map((title,index) => <Button key={title} title={title} secondary={f.step !== index}
        disabled={f.pending || (index > 0 && (!f.application?.details || f.dirty))} onPress={() => { f.clearFile(); f.setStep(index); }}/>)}</View>
      {f.stale && <Text style={styles.body}>Load the saved application and review it before making another change. Your unsaved details are still shown.</Text>}
      {f.application?.busy && <Text style={styles.body}>Finish or cancel assigned work before changing your application.</Text>}
      {f.step === 0 && <DetailsStep draft={f.draft} onChange={f.setDraft} disabled={f.pending || !f.canEdit} onSave={() => void f.save()} pending={f.pending}/>}
      {f.step === 1 && f.application && <DocumentsStep application={f.application} kind={f.kind} onKind={f.selectKind} expiresOn={f.expiresOn} onExpiry={f.setExpiresOn}
        file={f.file} onChoose={() => void f.chooseFile()} onCapture={() => void f.captureFile()} onClear={f.clearFile} onUpload={() => void f.upload()} onRemove={remove} onContinue={() => { f.clearFile(); f.setStep(2); }}
        disabled={f.pending || !f.canEdit || f.dirty} pending={f.pending}/>}
      {f.step === 2 && f.application && <ReviewStep application={f.application} onSubmit={() => void f.change('submit')} onReopen={reopen} onCompareFace={(consent) => void f.compareFace(consent)} pending={f.pending} disabled={f.pending || f.stale || f.dirty || !!f.file || f.application.busy}/>}
      <Button title="Refresh saved application" secondary onPress={reload} disabled={f.pending}/>
    </>}
  </Screen>;
}
export default function DriverApplication() {
  const { user } = useSession(); return user ? <Application key={user.id}/> : null;
}
