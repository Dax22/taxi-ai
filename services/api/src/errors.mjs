export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function check(condition, status, code, message) {
  if (!condition) throw new ApiError(status, code, message);
}

export function fields(value, allowed, required = allowed) {
  check(value !== null && typeof value === 'object' && !Array.isArray(value),
    400, 'INVALID_BODY', 'Send a JSON object.');
  check(Object.keys(value).every((key) => allowed.includes(key))
    && required.every((key) => Object.hasOwn(value, key)),
  400, 'INVALID_FIELDS', 'The request contains missing or unexpected fields.');
  return value;
}

export function label(value, name, min = 2, max = 80) {
  check(typeof value === 'string' && value.trim().length >= min
    && value.trim().length <= max && !/[\u0000-\u001f\u007f]/u.test(value),
  400, 'INVALID_INPUT', `${name} must contain ${min}–${max} characters.`);
  return value.trim();
}

export function emailAddress(value) {
  const email = label(value, 'Email address', 3, 254).toLowerCase();
  check(/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email), 400, 'INVALID_EMAIL', 'Enter a valid email address.');
  return email;
}
