import { DatabaseSync } from 'node:sqlite';
import { closeSync, fsyncSync, linkSync, lstatSync, mkdirSync, mkdtempSync, openSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { SCHEMA_VERSION, transaction } from './database.mjs';

export function validateSnapshot(db) {
  if (db.prepare('PRAGMA user_version').get().user_version !== SCHEMA_VERSION) throw new Error('Snapshot schema does not match this release.');
  const integrity = db.prepare('PRAGMA integrity_check').all();
  if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length) {
    throw new Error('Snapshot integrity validation failed.');
  }
}

function clearTransientState(db, now) {
  transaction(db, () => {
    db.exec('DELETE FROM sessions; DELETE FROM device_sessions; DELETE FROM voice_participants; DELETE FROM google_auth_attempts; DELETE FROM account_email_tokens; DELETE FROM account_email_jobs;');
    db.prepare(`UPDATE voice_calls SET
      ended_at = CASE WHEN status IN ('ringing', 'connecting', 'connected') THEN ? ELSE ended_at END,
      reason = CASE WHEN status IN ('ringing', 'connecting', 'connected') THEN 'snapshot_reset' ELSE reason END,
      version = version + CASE WHEN status IN ('ringing', 'connecting', 'connected') THEN 1 ELSE 0 END,
      status = CASE WHEN status IN ('ringing', 'connecting', 'connected') THEN 'ended' ELSE status END,
      offer_sdp = NULL, answer_sdp = NULL, caller_session = '', callee_session = NULL,
      caller_client = '', callee_client = NULL`).run(now);
    db.prepare(`UPDATE location_shares SET active = 0, position_json = NULL, session_hash = NULL,
      client_hash = NULL, stopped_at = COALESCE(stopped_at, ?)`).run(now);
    db.prepare(`UPDATE driver_availability SET active = 0, area_id = NULL, position_json = NULL,
      latitude = NULL, longitude = NULL, expires_at = NULL,
      native_session_id = NULL, session_hash = NULL, client_hash = NULL, stopped_at = COALESCE(stopped_at, ?), reason = COALESCE(reason, 'snapshot_reset')`).run(now);
    db.prepare(`UPDATE trip_share_links SET active=0,token_hash=NULL,session_hash=NULL,version=version+1,
      ended_at=?,reason='snapshot_reset' WHERE active=1`).run(now);
    db.prepare(`UPDATE guest_ride_links SET active=0,token_hash=NULL,session_binding=NULL,version=version+1,
      ended_at=?,reason='snapshot_reset' WHERE active=1`).run(now);
    db.prepare(`UPDATE parcel_tracking_links SET active=0,token_hash=NULL,version=version+1,
      ended_at=?,reason='snapshot_reset' WHERE active=1`).run(now);
    db.prepare(`UPDATE family_shares SET active=0,version=version+1,ended_at=?,reason='snapshot_reset'
      WHERE active=1 OR reason='completed'`).run(now);
    db.exec("UPDATE family_push_jobs SET status='suppressed',token='',ticket=NULL,lease_until=0 WHERE status IN ('queued','provider_accepted');");
    db.exec("UPDATE safety_monitor_sessions SET enabled=0,binding='',expires_at=0; UPDATE safety_auto_alerts SET status='cancelled',version=version+1 WHERE status IN ('countdown','queued'); UPDATE safety_delivery_jobs SET status='cancelled' WHERE status IN ('queued','sending','failed');");
    db.prepare("UPDATE dispatch_offers SET status='revoked',closed_at=? WHERE status='pending'").run(now);
    db.exec('DELETE FROM location_quotes WHERE ride_id IS NULL;');
    db.exec('DELETE FROM account_revisions; UPDATE worker_leases SET expires_at=0, fencing_token=fencing_token+1;');
  });
}

/** Publish a checked, sanitized snapshot to a NEW filename. Never copy a live WAL file. */
export function saveSnapshot(sourcePath, destinationPath, { now = Date.now() } = {}) {
  const source = resolve(sourcePath), destination = resolve(destinationPath);
  if (source === destination || !destination.endsWith('.sqlite')) throw new Error('Choose a new .sqlite destination, separate from the source.');
  if (!lstatSync(source).isFile()) throw new Error('The source must be an existing regular database file.');
  for (const path of [destination, destination + '-wal', destination + '-shm']) {
    try { lstatSync(path); throw new Error('The destination or a SQLite sidecar already exists. Nothing was overwritten.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = mkdtempSync(join(dirname(destination), '.taxi-ai-snapshot-'));
  const working = join(temporary, 'working.sqlite'), clean = join(temporary, 'clean.sqlite');
  let input, snapshot;
  try {
    // Empty, private files are accepted by VACUUM INTO. The final hard link fails
    // atomically if another process creates the requested destination first.
    for (const path of [working, clean]) closeSync(openSync(path, 'wx', 0o600));
    input = new DatabaseSync(source, { readOnly: true });
    input.exec('PRAGMA busy_timeout = 5000; PRAGMA synchronous = FULL;');
    validateSnapshot(input);
    input.prepare('VACUUM INTO ?').run(working);
    input.close(); input = null;
    snapshot = new DatabaseSync(working);
    snapshot.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL; PRAGMA secure_delete = ON;');
    clearTransientState(snapshot, now);
    validateSnapshot(snapshot);
    snapshot.prepare('VACUUM INTO ?').run(clean);
    snapshot.close(); snapshot = null;
    const check = new DatabaseSync(clean, { readOnly: true });
    try { validateSnapshot(check); } finally { check.close(); }
    const fd = openSync(clean, 'r');
    try { fsyncSync(fd); } finally { closeSync(fd); }
    linkSync(clean, destination);
    const directory = openSync(dirname(destination), 'r');
    try { fsyncSync(directory); } finally { closeSync(directory); }
    return { destination, schema: SCHEMA_VERSION };
  } finally {
    input?.close(); snapshot?.close();
    rmSync(temporary, { recursive: true, force: true });
  }
}
