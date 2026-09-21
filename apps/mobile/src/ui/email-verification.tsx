import { useCallback, useEffect, useRef, useState } from 'react';
import { Text } from 'react-native';
import type { MobileClient } from '../api/client.ts';
import { useResource } from './use-resource';
import { Button, Card, Loading, Notice, Pill, styles } from './components';

export function EmailVerification({ client }: { client: MobileClient }) {
  const resource = useResource(useCallback(() => client.emailStatus(), [client]));
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [error, setError] = useState('');
  const mounted = useRef(true), pending = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function request() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(''); setNotice('');
    try { await client.requestVerification(); if (mounted.current) setNotice('Request received. Check your inbox and spam for a verification link. Open it, confirm your email, then return here and refresh.'); }
    catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : 'Could not request verification.'); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  const value = resource.value;
  return <Card><Text accessibilityRole="header" style={styles.h2}>Your email</Text><Notice message={error || resource.error}/>
    {resource.busy ? <Loading/> : value && <><Pill>{value.verified ? 'EMAIL VERIFIED' : 'NOT YET VERIFIED'}</Pill>
      <Text style={styles.body}>{value.email}</Text><Text style={styles.small}>{value.verified ? 'This confirms your mailbox. Driver approval is a separate step.' : value.enabled ? 'Confirm your mailbox using the link we send.' : 'Email delivery is being set up. You can continue using the preview.'}</Text>
      {!value.verified && value.enabled && <Button title="Send verification email" onPress={() => void request()} busy={busy}/>}</>}
    {!!notice && <Text style={styles.body} accessibilityLiveRegion="polite">{notice}</Text>}
    <Button title="Refresh email status" secondary disabled={busy || resource.busy} onPress={() => { setNotice(''); resource.reload(); }}/></Card>;
}
