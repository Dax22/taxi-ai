const name = (secure) => secure ? '__Host-taxi_ai_google' : 'taxi_ai_google';
export function googleCookie(value, secure = false, age = 600) {
  // Lax is limited to the short-lived OAuth binding. App session remains Strict.
  return `${name(secure)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? '; Secure' : ''}`;
}
export function readGoogleCookie(header = '', secure = false) {
  const matches = header.split(';').map((s) => s.trim()).filter((s) => s.startsWith(`${name(secure)}=`));
  const value = matches.length === 1 ? matches[0].slice(name(secure).length + 1) : null;
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : null;
}
