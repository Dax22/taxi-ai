import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
/** Navigation or mode changes discard late results; private data is never disk-cached. */
export function useResource<T>(load: () => Promise<T>) {
  const [value, setValue] = useState<T | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(true), [revision, setRevision] = useState(0);
  useFocusEffect(useCallback(() => {
    let active = true; setBusy(true); setError(''); setValue(null);
    void load().then((next) => { if (active) setValue(next); }).catch((e: unknown) => { if (active) setError(e instanceof Error ? e.message : 'Unable to load.'); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [load, revision]));
  return { value, error, busy, reload: () => setRevision((v) => v + 1) };
}
