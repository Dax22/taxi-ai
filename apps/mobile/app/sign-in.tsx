import { useState } from 'react';
import { Platform, View } from 'react-native';
import { Text } from '../src/ui/typography';
import { previewHeader } from '../src/api/client.ts';
import { useSession } from '../src/session/provider';
import { chooseGoogleIdentity, googleAvailable } from '../src/session/google-provider';
import { GoogleButton } from '../src/ui/google-button';
import { PasswordRecovery } from '../src/ui/password-recovery';
import { Button, Card, Field, Heading, Logo, Notice, Pill, Screen, styles } from '../src/ui/components';
export default function SignIn() {
  const { client, notice } = useSession();
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [name, setName] = useState(Platform.OS === 'ios' ? 'My iPhone / iPad' : 'My Android device');
  const [creating, setCreating] = useState(false), [fullName, setFullName] = useState('');
  const [showPreview, setShowPreview] = useState(false), [tester, setTester] = useState(''), [key, setKey] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [recovering, setRecovering] = useState(false);
  async function submit() {
    setError(''); setBusy(true);
    try {
      if (creating) await client.register(fullName.trim(), email.trim(), password, name.trim(), previewHeader(tester.trim(), key.trim()));
      else await client.login(email.trim(), password, name.trim(), previewHeader(tester.trim(), key.trim()));
      setPassword(''); setKey('');
    }
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
  return <Screen><Logo/><Pill>NIGERIA · APP PREVIEW</Pill><Heading title={'Your journey starts here.'} subtitle="Sign in, then set up your Customer or Driver experience."/>
    <Notice message={error || notice}/><Card>{recovering ? <PasswordRecovery client={client} initialEmail={email} preview={() => previewHeader(tester.trim(), key.trim())} back={() => setRecovering(false)}/> : <><Text style={styles.h2}>{creating ? 'Create your account.' : 'Welcome back.'}</Text><Text style={styles.body}>One account on the website and your phone.</Text>
      {googleAvailable() && <><GoogleButton onPress={() => void continueWithGoogle()} busy={busy} disabled={name.trim().length < 2}/><Text style={styles.small}>Creates your Taxi Ai account if you’re new. Or sign in with email below.</Text></>}
      {creating && <Field label="Your name" value={fullName} onChangeText={setFullName} autoComplete="name" maxLength={80} editable={!busy}/>}
      <Field label="Email address" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" editable={!busy}/>
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete={creating ? 'new-password' : 'current-password'} editable={!busy}/>
      <Field label="Name this device" value={name} onChangeText={setName} maxLength={60} editable={!busy}/>
      <Button title={creating ? 'Create account' : 'Sign in'} onPress={() => void submit()} busy={busy} disabled={!email.trim() || password.length < 12 || name.trim().length < 2 || creating && fullName.trim().length < 2}/>
      <Button title={creating ? 'Already have an account? Sign in' : 'New here? Create account'} secondary disabled={busy} onPress={() => { setCreating(!creating); setError(''); setPassword(''); }}/>
      {!creating && <Button title="Forgot password?" secondary disabled={busy} onPress={() => { setPassword(''); setError(''); setRecovering(true); }}/>}</>}
      <Button title={showPreview ? 'Hide preview access' : 'Invited tester? Add preview access'} secondary disabled={busy} onPress={() => setShowPreview(!showPreview)}/>
      {showPreview && <View style={styles.stack}><Field label="Preview name" value={tester} onChangeText={setTester} autoCapitalize="none" autoCorrect={false} editable={!busy}/><Field label="Preview access key" value={key} onChangeText={setKey} secureTextEntry autoCapitalize="none" autoCorrect={false} maxLength={64} editable={!busy}/><Text style={styles.small}>Provided for the private website preview. This is separate from your account password.</Text></View>}
    </Card><Text style={styles.small}>Choose Customer or Driver after creating your account. This preview uses test journeys and orders.</Text>
  </Screen>;
}
