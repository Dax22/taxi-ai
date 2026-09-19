export const ACTIVE_CALL_STATES = Object.freeze(['ringing', 'connecting', 'connected']);
export const CALL_LABELS = Object.freeze({ ringing: 'Ringing', connecting: 'Connecting audio', connected: 'Connected',
  ended: 'Call ended', declined: 'Call declined', missed: 'Missed call', failed: 'Connection failed' });
export const CALL_REASONS = Object.freeze({ hangup: 'Ended by a participant', declined: 'Declined', no_answer: 'No answer',
  connection_timeout: 'Audio did not connect', connection_lost: 'Connection was lost', ride_closed: 'The trip ended',
  session_ended: 'A participant signed out', max_duration: 'The 30-minute test limit was reached',
  media_failed: 'Microphone or audio connection failed', client_closed: 'The call window closed', unavailable: 'Calling is unavailable' });
export const isActiveCall = (call) => Boolean(call && ACTIVE_CALL_STATES.includes(call.status));
