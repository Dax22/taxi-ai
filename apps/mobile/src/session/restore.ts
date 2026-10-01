/** Foreground restoration must clear work tracking even when an empty/corrupt vault emits no account event. */
export async function restoreSession(client: { restore(): Promise<void>; account(): unknown }, stopWorkTracking: () => Promise<void>): Promise<void> {
  try { await client.restore(); }
  finally { if (!client.account()) await stopWorkTracking().catch(() => {}); }
}
