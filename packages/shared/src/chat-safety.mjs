/** Local, advisory English-pattern checks. No model, network, storage or enforcement. */
export const CHAT_SAFETY_NOTICE = 'Automated safety hints can miss risks or misunderstand messages. No warning does not mean a message is safe. Use Report message if concerned.';
const hints = Object.freeze({
  pin_request: 'Code request: share a pickup PIN only in person after checking the driver and vehicle. Share a delivery drop-off code only after handover. Never send login or payment codes in chat.',
  payment_link: 'Payment-link caution: this message contains a link and payment language. Its destination has not been verified. Do not enter passwords, payment codes or card details through chat links.',
  off_app_payment: 'Payment caution: this may ask you to cancel or pay outside Taxi Ai. Keep fare agreement in the app and use only its supported payment flow. This preview does not collect real payments.',
  threatening_language: 'Possible threat: if this message makes you feel unsafe, avoid confrontation and use Report message or seek help. This hint does not contact support or emergency services.',
  harassment: 'Possible harassment: you can report unwanted or abusive messages. A hint is not a finding against either participant.',
});
function actionable(pattern, clause) {
  return [...clause.matchAll(new RegExp(pattern.source, 'g'))].some((match) =>
    !/\b(?:never|do not|don't|dont|avoid)\s+(?:ever\s+)?(?:cancel\s+and\s+)?$/.test(clause.slice(0, match.index))
    && !/\b(?:map|location)\s+pin\b/.test(match[0]));
}
export function chatSafetyHints(body) {
  if (typeof body !== 'string') return [];
  const text = body.slice(0, 2000).normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/[’‘]/g, "'").toLowerCase();
  const found = new Set();
  // Clauses prevent a safety reminder from suppressing a separate request.
  for (const clause of text.split(/[.!?;\n]+|\bbut\b/)) {
    if (actionable(/\b(?:send|share|give|tell|text|message|need|provide|wetin|drop)\b.{0,80}\b(?:pin|otp|verification code|pickup code|pick up code|drop off code|dropoff code|login code)\b/, clause)) found.add('pin_request');
    if (actionable(/\b(?:cancel|end)\b.{0,80}\b(?:pay|cash|transfer|bank|cheaper)\b/, clause)
      || actionable(/\b(?:pay|payment|cash|transfer|money)\b.{0,80}\b(?:outside|off[ -]?app|directly|my account|personal account|bank account|account number)\b/, clause)
      || actionable(/\b(?:outside|off[ -]?app)\b.{0,60}\b(?:pay|payment|cash|transfer)\b/, clause)) found.add('off_app_payment');
    if (/\b(?:i(?:'ll| will| am going to)|we(?:'ll| will))\s+(?:hurt|kill|attack|beat|rape)\s+(?:you|u)\b|\byou will regret\b|\bi know where you live\b/.test(clause)) found.add('threatening_language');
    if (/\b(?:you(?:'re| are)?|u)\s+(?:(?:a|an|so|such a)\s+)?(?:idiot|stupid|bitch|moron)\b|\b(?:send|show)\s+(?:me\s+)?(?:nudes|naked pictures)\b|\b(?:sleep|have sex) with me\b/.test(clause)) found.add('harassment');
  }
  // Unverified does not mean malicious. Never navigate to or unfurl a link.
  const link = /(?:https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|net|org|ng|co|io|app|me|ly)\b)/.test(text);
  if (link && /\b(?:pay|payment|transfer|deposit|refund|bank|card|otp|wallet|fee)\b/.test(text)) found.add('payment_link');
  return [...found].map((kind) => ({ kind, message: hints[kind] }));
}
