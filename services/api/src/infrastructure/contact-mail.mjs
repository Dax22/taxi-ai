import nodemailer from 'nodemailer';
import { normalizeContactMessage } from '../shared/contact-message.mjs';

const RECIPIENT = 'info@taxiai.app';

/** The destination is fixed; provider credentials and delivery errors stay server-side. */
export function createContactMail({ config, transportFactory = nodemailer.createTransport } = {}) {
  if (!config?.enabled) return Object.freeze({ enabled: false, send: async () => { throw new Error('Contact email is unavailable.'); }, close() {} });
  const transport = transportFactory({ host: config.host, port: config.port, secure: config.port === 465,
    requireTLS: true, tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true, servername: config.host },
    auth: { user: config.user, pass: config.password }, pool: true, maxConnections: 1, maxMessages: 20,
    connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 10_000, dnsTimeout: 5000,
    logger: false, debug: false, transactionLog: false, disableFileAccess: true, disableUrlAccess: true });
  return Object.freeze({ enabled: true,
    async send(input) {
      const { name, email, message } = normalizeContactMessage(input);
      try {
        const info = await transport.sendMail({ from: { name: 'Taxi Ai', address: config.from },
          to: { address: RECIPIENT }, replyTo: { name, address: email },
          envelope: { from: config.from, to: [RECIPIENT] }, subject: 'New message from the Taxi Ai contact page',
          text: `Name: ${name}\nEmail: ${email}\n\nMessage:\n${message}` });
        if (!info?.accepted?.includes(RECIPIENT) || info.rejected?.length) throw new Error('Delivery rejected.');
      } catch {
        throw new Error('Contact email could not be delivered.');
      }
    },
    close() { transport.close(); },
  });
}
