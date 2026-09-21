import { useEffect, useRef, useState } from 'react';
import { Text } from 'react-native';
import type { MobileClient } from '../api/client.ts';
import { Button, Field, Notice, styles } from './components';

/** Recovery requests reuse the native transport; the email opens the responsive website. */
export function PasswordRecovery({ client, initialEmail, preview, back }: { client: MobileClient; initialEmail: string; preview(): string; back(): void }) {
  const [email, setEmail] = useState(initialEmail), [busy, setBusy] = useState(false), [sent, setSent] = useState(false), [error, setError] = useState('');
  const mounted = useRef(true), pending = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function submit() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try { await client.requestPasswordReset(email.trim(), preview()); if (mounted.current) { setSent(true); setEmail(''); } }
    catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : 'Could not request a reset email.'); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  return <><Text accessibilityRole="header" style={styles.h2}>{sent ? 'Check your inbox.' : 'Let’s get you back in.'}</Text><Notice message={error}/>
    {sent ? <Text accessibilityLiveRegion="polite" style={styles.body}>If this address has a password account, we’ll email a reset link. Check spam. Open the link, choose a new password, then return to the app to sign in.</Text>
      : <><Text style={styles.body}>Enter the email address you use for Taxi Ai.</Text><Field label="Email address" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" maxLength={254} editable={!busy}/>
        <Button title="Send reset email" onPress={() => void submit()} busy={busy} disabled={!email.trim()}/></>}
    <Text style={styles.small}>Joined with Google? Use Sign in with Google. Wait a minute before requesting another reset email.</Text>
    <Button title="Back to sign in" secondary onPress={back} disabled={busy}/></>;
}
