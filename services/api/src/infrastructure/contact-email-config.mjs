import { createEmailConfig } from './email-config.mjs';

/** Contact delivery is opt-in and never inherits account-email credentials or mode. */
export function createContactEmailConfig(env = process.env, runtime) {
  const translated = { TAXI_AI_EMAIL_MODE: env.TAXI_AI_CONTACT_EMAIL_MODE };
  for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'FROM']) {
    translated[`TAXI_AI_SMTP_${key}`] = env[`TAXI_AI_CONTACT_SMTP_${key}`];
  }
  try {
    return createEmailConfig(translated, runtime);
  } catch (error) {
    throw new Error(error.message.replaceAll('TAXI_AI_EMAIL_MODE', 'TAXI_AI_CONTACT_EMAIL_MODE'));
  }
}
