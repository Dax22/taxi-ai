import { useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { previewHeader } from '../src/api/client.ts';
import { useSession } from '../src/session/provider';
import { chooseGoogleIdentity, googleAvailable } from '../src/session/google-provider';
import { GoogleButton } from '../src/ui/google-button';
import { PasswordRecovery } from '../src/ui/password-recovery';
import { Button, Card, Field, Heading, Logo, Notice, Pill, Screen, openWebsite, styles } from '../src/ui/components';
export default function SignIn() {
  const { client, notice } = useSession();
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [name, setName] = useState(Platform.OS === 'ios' ? 'My iPhone / iPad' : 'My Android device');
  const [showPreview, setShowPreview] = useState(false), [tester, setTester] = useState(''), [key, setKey] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [recovering, setRecovering] = useState(false);
  async function submit() {
    setError(''); setBusy(true);
    try { await client.login(email.trim(), password, name, previewHeader(tester.trim(), key.trim())); setPassword(''); setKey(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Sign-in failed.'); }
    finally { setBusy(false); }
  }
  async function continueWithGoogle() {
    if (busy) return;
    setError(''); setBusy(true);
    try { await client.googleLogin(name, chooseGoogleIdentity, previewHeader(tester.trim(), key.trim())); setPassword(''); setKey(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Google sign-in failed.'); }
    finally { setBusy(false); }
  }
  return <Screen><Logo/><Pill>ABUJA · APP PREVIEW</Pill><Heading title={'Your city.\nYour terms.'} subtitle="One account for your journeys and your work."/>
    <Notice message={error || notice}/><Card>{recovering ? <PasswordRecovery client={client} initialEmail={email} preview={() => previewHeader(tester.trim(), key.trim())} back={() => setRecovering(false)}/> : <><Text style={styles.h2}>Welcome back.</Text><Text style={styles.body}>One account on the website and your phone.</Text>
      {googleAvailable() && <><GoogleButton onPress={() => void continueWithGoogle()} busy={busy} disabled={name.trim().length < 2}/><Text style={styles.small}>Creates your Taxi Ai account if you’re new. Or sign in with email below.</Text></>}
      <Field label="Email address" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" editable={!busy}/>
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="current-password" editable={!busy}/>
      <Field label="Name this device" value={name} onChangeText={setName} maxLength={60} editable={!busy}/>
      <Button title="Sign in" onPress={() => void submit()} busy={busy} disabled={!email.trim() || password.length < 12 || name.trim().length < 2}/>
      <Button title="Forgot password?" secondary disabled={busy} onPress={() => { setPassword(''); setError(''); setRecovering(true); }}/></>}
      <Button title={showPreview ? 'Hide preview access' : 'Invited tester? Add preview access'} secondary disabled={busy} onPress={() => setShowPreview(!showPreview)}/>
      {showPreview && <View style={styles.stack}><Field label="Preview name" value={tester} onChangeText={setTester} autoCapitalize="none" autoCorrect={false} editable={!busy}/><Field label="Preview access key" value={key} onChangeText={setKey} secureTextEntry autoCapitalize="none" autoCorrect={false} maxLength={64} editable={!busy}/><Text style={styles.small}>Provided for the private website preview. This is separate from your account password.</Text></View>}
    </Card><Button title="Create an account on the website" secondary onPress={() => void openWebsite(client.origin).catch(() => setError('Could not open the website.'))}/>
    <Text style={styles.small}>Native booking is being built. This preview includes your profile, driver application status and saved journey activity.</Text>
  </Screen>;
}
