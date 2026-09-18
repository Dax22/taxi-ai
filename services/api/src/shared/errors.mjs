/** Application failures carry stable codes; HTTP status mapping belongs to HTTP. */
export class ApplicationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ApplicationError';
    this.code = code;
  }
}

export function check(condition, code, message) {
  if (!condition) throw new ApplicationError(code, message);
}
