import { check } from '../../shared/errors.mjs';

export const MESSAGE_LIMIT = 500;
export const PAGE_SIZE = 100;
export const REPORT_REASONS = ['harassment', 'unsafe_request', 'spam', 'other'];

export function messageBody(value) {
  check(typeof value === 'string' && value.length <= 2000 && value.trim().length > 0
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value),
  'INVALID_MESSAGE', 'Write a message of 1–2,000 characters.');
  return value.replace(/\r\n?/g, '\n').trim();
}

export function sequence(value) {
  check(Number.isSafeInteger(value) && value >= 0, 'INVALID_CURSOR', 'Use a valid message sequence.');
  return value;
}

