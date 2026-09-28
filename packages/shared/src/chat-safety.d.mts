export const CHAT_SAFETY_NOTICE: string;
export type ChatSafetyKind = 'pin_request' | 'payment_link' | 'off_app_payment' | 'threatening_language' | 'harassment';
export function chatSafetyHints(body: unknown): Array<{kind: ChatSafetyKind; message: string}>;
