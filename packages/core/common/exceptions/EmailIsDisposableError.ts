export class EmailDisposableNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmailDisposableNotAllowedError';

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, EmailDisposableNotAllowedError);
    }
  }
}
