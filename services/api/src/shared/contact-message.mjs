const HEADER_CONTROLS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const MESSAGE_CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;
const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;

export function normalizeContactMessage(input) {
  const { name, email, message } = input ?? {};
  if ([name, email, message].some((value) => typeof value !== 'string')
    || HEADER_CONTROLS.test(name) || HEADER_CONTROLS.test(email) || MESSAGE_CONTROLS.test(message)) {
    throw new Error('Invalid contact message.');
  }
  const senderName = name.trim(), senderEmail = email.trim(), body = message.trim();
  const local = senderEmail.split('@')[0];
  if (!senderName || senderName.length > 100 || senderEmail.length > 254 || !EMAIL.test(senderEmail)
    || local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..')
    || body.length < 10 || body.length > 5000) throw new Error('Invalid contact message.');
  return { name: senderName, email: senderEmail, message: body };
}
