import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { ApiError } from '../api/client';
import { useSession } from '../session/provider';
import { DRIVER_DOCUMENTS, driverDocumentDeadline } from '../../../../packages/shared/src/driver-onboarding.mjs';
import type { DocumentKind, DriverCommands, DriverOnboarding } from '../../../../packages/shared/src/mobile-contracts.mjs';
import { draftFromDetails, detailsFromDraft } from './form';
import type { DriverDraft } from './form';
import { pickDriverFile } from './files';
import type { DriverFile } from './files';

export function useDriverOnboarding(editVehicle = false) {
  const { client, user } = useSession(), accountId = user!.id;
  const [application, setApplication] = useState<DriverOnboarding | null>(null);
  const [draft, setDraft] = useState<DriverDraft>(() => draftFromDetails(null));
  const [step, setStep] = useState(0), [pending, setPending] = useState(false), [loading, setLoading] = useState(true);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [stale, setStale] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [kind, setKind] = useState<DocumentKind>('profile_photo'), [expiresOn, setExpiresOn] = useState('');
  const [file, setFile] = useState<DriverFile | null>(null);
  const lifecycle = useRef({ epoch: 0, active: false, busy: false });
  const savedDraft = useRef(''), retry = useRef<{ fingerprint: string; key: string } | null>(null);
  const dirty = JSON.stringify(draft) !== savedDraft.current;
  const editable = !application || ['draft','changes_requested','rejected'].includes(application.status);
  const canEdit = loaded && editable && !application?.busy && !stale;

  function keyFor(action: string, data: unknown) {
    const fingerprint = JSON.stringify([action, data]);
    if (retry.current?.fingerprint !== fingerprint) retry.current = { fingerprint, key: randomUUID() };
    return retry.current.key;
  }
  function accept(app: DriverOnboarding | null, name: string, vehicle = client.account()?.driver?.vehicle) {
    setApplication(app); const next = draftFromDetails(app?.details ?? null, app?.vehicle ?? vehicle, name);
    savedDraft.current = JSON.stringify(next); setDraft(next); setFile(null); setExpiresOn('');
    setKind((Object.keys(DRIVER_DOCUMENTS) as DocumentKind[]).find((k) => app?.eligibility.missing.includes(k)) ?? 'profile_photo');
    setStale(false); retry.current = null;
  }
  async function load(assertCurrent: () => void) {
    const account = await client.session(); assertCurrent();
    const app = account.driver ? await client.application() : null; assertCurrent();
    accept(app, account.name, account.driver?.vehicle);
    setLoaded(true);
    setStep(app && !['draft','changes_requested','rejected'].includes(app.status) ? 2 : editVehicle ? 0 : app?.details ? 1 : 0);
  }
  async function run(action: (assertCurrent: () => void) => Promise<void>) {
    if (!lifecycle.current.active || lifecycle.current.busy) return;
    const epoch = lifecycle.current.epoch;
    const current = () => lifecycle.current.active && lifecycle.current.epoch === epoch && client.account()?.id === accountId;
    const assertCurrent = () => { if (!current()) throw new Error('Your account changed.'); };
    lifecycle.current.busy = true; setPending(true); setError(''); setNotice('');
    try { await action(assertCurrent); }
    catch (e) {
      if (current()) {
        setError(e instanceof Error ? e.message : 'Unable to update the application.');
        if (e instanceof ApiError && ['STALE_VERSION','APPLICATION_LOCKED','DRIVER_BUSY','DRIVER_PROFILE_EXISTS'].includes(e.code)) setStale(true);
      }
    } finally { if (current()) { lifecycle.current.busy = false; setPending(false); setLoading(false); } }
  }
  useFocusEffect(useCallback(() => {
    lifecycle.current = { epoch: lifecycle.current.epoch + 1, active: true, busy: false };
    setLoading(true); setLoaded(false); setApplication(null); setDraft(draftFromDetails(null)); setFile(null); savedDraft.current = ''; retry.current = null;
    void run(load);
    return () => { lifecycle.current.active = false; lifecycle.current.epoch++; lifecycle.current.busy = false; retry.current = null; setFile(null); };
    // Session object refreshes must not discard an unfinished form or an open system file picker.
  }, [client, accountId]));

  async function command<A extends keyof DriverCommands>(action: A, data: DriverCommands[A]) {
    const result = await client.applicationCommand(action, data, keyFor(action, data));
    retry.current = null; return result;
  }
  const save = () => run(async (current) => {
    const details = detailsFromDraft(draft); let app = application;
    if (!app) {
      if (!client.account()?.driver) {
        const vehicle = details.vehicle;
        await client.addDriver(vehicle, keyFor('start', vehicle)); current(); retry.current = null;
      }
      app = await client.application(); current(); setApplication(app);
      if (app.details || app.documents.length || app.status !== 'draft') throw new ApiError('This application was changed elsewhere. Load and review the saved details.', 'STALE_VERSION', 409);
    }
    const next = await command('save', { expectedVersion: app.version, details }); current();
    accept(next, user!.name); setStep(1); setNotice('Your details are saved. If you changed the vehicle, upload its replacement vehicle document, insurance and vehicle photo next.');
  });
  const chooseFile = () => run(async (current) => { const next = await pickDriverFile(); current(); if (next) setFile(next); });
  const upload = () => run(async (current) => {
    if (!file || !application) return;
    const expiry = DRIVER_DOCUMENTS[kind].expires ? expiresOn.trim() : null;
    if (DRIVER_DOCUMENTS[kind].expires && driverDocumentDeadline(expiry) === null) throw new Error('Enter a valid expiry date as YYYY-MM-DD.');
    const next = await command('upload', { expectedVersion: application.version, kind, ...file, expiresOn: expiry }); current();
    setApplication(next); setFile(null); setExpiresOn('');
    setKind((Object.keys(DRIVER_DOCUMENTS) as DocumentKind[]).find((k) => next.eligibility.missing.includes(k)) ?? kind);
    setNotice('Document saved privately to your application.');
  });
  const change = (action: 'submit' | 'reopen' | 'remove', documentId?: string) => run(async (current) => {
    if (!application) return;
    const next = action === 'remove' ? await command('remove', { expectedVersion: application.version, documentId: documentId! })
      : await command(action, { expectedVersion: application.version }); current();
    accept(next, user!.name); setStep(action === 'reopen' ? 0 : action === 'remove' ? 1 : 2);
    setNotice(action === 'submit' ? 'Application submitted. Your documents are awaiting manual review.'
      : action === 'reopen' ? 'Application reopened. New rides are paused until a new approval.' : 'Document removed.');
  });
  const deleteProfile = (confirmation: string, onDeleted: () => void) => run(async (current) => {
    if (!application || stale || application.busy || confirmation !== 'DELETE') return;
    const data = { expectedVersion: application.version, confirmation };
    const account = await client.deleteDriver(data.expectedVersion, confirmation, keyFor('delete-profile', data)); current();
    if (account.driver) throw new ApiError('Your Driver profile changed. Refresh it and confirm again.', 'STALE_VERSION', 409);
    retry.current = null; accept(null, account.name); onDeleted();
  });
  return { application, draft, setDraft, step, setStep, pending, loading, error, notice, stale, dirty, canEdit,
    kind, expiresOn, setExpiresOn, file, clearFile: () => setFile(null),
    selectKind: (next: DocumentKind) => { setKind(next); setExpiresOn(''); setFile(null); },
    reload: () => run(load), save, chooseFile, upload, change, deleteProfile };
}
