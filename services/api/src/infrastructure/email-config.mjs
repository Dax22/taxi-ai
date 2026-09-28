/** Explicit opt-in. Credentials stay server-side; no arbitrary return URL is accepted. */
export function createEmailConfig(env = process.env, runtime = { mode: 'local', port: 3000 }) {
  const mode = env.TAXI_AI_EMAIL_MODE || 'off';
  const keys = ['HOST', 'PORT', 'USER', 'PASSWORD', 'FROM'];
  const values = Object.fromEntries(keys.map((key) => [key, env[`TAXI_AI_SMTP_${key}`] || '']));
  if (!['off', 'smtp'].includes(mode)) throw new Error('TAXI_AI_EMAIL_MODE must be off or smtp.');
  if (mode === 'off') {
    if (Object.values(values).some(Boolean)) throw new Error('Set TAXI_AI_EMAIL_MODE=smtp when configuring SMTP, or remove the SMTP values.');
    return Object.freeze({ enabled: false });
  }
  if (!Object.values(values).every(Boolean)) throw new Error('SMTP needs HOST, PORT, USER, PASSWORD and FROM settings.');
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(values.HOST)) throw new Error('SMTP HOST must be a DNS hostname.');
  if (!['465', '587'].includes(values.PORT)) throw new Error('SMTP PORT must be 465 (TLS) or 587 (required STARTTLS).');
  if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$/.test(values.FROM)) throw new Error('SMTP FROM must contain one sender email address, without a display name.');
  if ([values.USER, values.PASSWORD].some((v) => v.length > 1024 || /[\r\n\u0000]/.test(v))) throw new Error('SMTP credentials contain unsupported characters or are too long.');
  const origin = runtime.mode === 'staging' ? runtime.publicOrigin : `http://localhost:${runtime.port ?? 3000}`;
  const url = new URL(origin);
  if (url.origin !== origin || (runtime.mode === 'staging' && url.protocol !== 'https:')) throw new Error('Account email links require the configured website origin.');
  return Object.freeze({ enabled: true, host: values.HOST, port: Number(values.PORT), user: values.USER,
    password: values.PASSWORD, from: values.FROM, origin });
}
