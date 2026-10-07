import nodemailer from 'nodemailer';

/** Delivery adapter; business services never receive SMTP credentials or SDK objects. */
export function createAccountMail({ config, transportFactory = nodemailer.createTransport } = {}) {
  if (!config?.enabled) return Object.freeze({ enabled: false, send: async () => { throw new Error('Email is disabled.'); }, close() {} });
  const transport = transportFactory({ host: config.host, port: config.port, secure: config.port === 465,
    requireTLS: true, tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true, servername: config.host },
    auth: { user: config.user, pass: config.password }, pool: true, maxConnections: 1, maxMessages: 20,
    connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 10_000, dnsTimeout: 5000,
    logger: false, debug: false, transactionLog: false, disableFileAccess: true, disableUrlAccess: true });
  return Object.freeze({ enabled: true,
    async send({ email, purpose, token, name = 'Taxi Ai member', intent = null }) {
      if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$/.test(email)
        || !['verify', 'reset', 'changed', 'welcome'].includes(purpose)
        || (['verify', 'reset'].includes(purpose) && !/^[a-f0-9]{64}$/.test(token ?? ''))
        || (!['verify', 'reset'].includes(purpose) && token != null)) throw new Error('Invalid account email.');
      const safeName = typeof name === 'string' && name.trim() ? name.trim().slice(0, 80) : 'Taxi Ai member';
      const subject = purpose === 'verify' ? 'Verify your Taxi Ai email' : purpose === 'reset' ? 'Reset your Taxi Ai password'
        : purpose === 'welcome' ? 'Welcome to Taxi Ai' : 'Your Taxi Ai password was changed';
      // Fragments are not sent to the server or included in HTTP referrers.
      const link = purpose === 'changed' ? `${config.origin}/account-recovery`
        : purpose === 'welcome' ? intent === 'eats_seller' ? `${config.origin}/eats/sell` : `${config.origin}/app${intent === 'driver' ? '?start=driver' : ''}`
          : `${config.origin}/account-recovery#${purpose}=${token}`;
      const text = purpose === 'verify'
        ? `Confirm this email address for your Taxi Ai account. Open the link and choose Verify email:\n\n${link}\n\nThis link expires in 24 hours and works once. If you did not create this account, ignore this message.`
        : purpose === 'reset'
          ? `You requested a new Taxi Ai password. Open this link to choose it:\n\n${link}\n\nThis link expires in 30 minutes and works once. Your password stays unchanged until you submit a new one. If you did not request this, ignore this message.`
          : purpose === 'welcome'
            ? `Welcome to Taxi Ai, ${safeName}.\n\nYour Taxi Ai account is ready. Use one account to book rides, send parcels and order food${intent === 'driver' ? ', and continue your Drive & Deliver application' : intent === 'eats_seller' ? ', and set up your restaurant or private kitchen' : ''}.\n\nOpen Taxi Ai:\n${link}\n\nYour journey. Your choice.`
            : `Your Taxi Ai password has been changed and all existing Taxi Ai sessions have been signed out.\n\nIf this was not you, request another password reset here:\n${link}\n\nNever share your password or recovery link.`;
      const info = await transport.sendMail({ from: { name: 'Taxi Ai', address: config.from }, to: { address: email },
        envelope: { from: config.from, to: [email] }, subject, text });
      if (!info.accepted?.includes(email) || info.rejected?.length) throw new Error('Account email was not accepted.');
    },
    close() { transport.close(); },
  });
}
