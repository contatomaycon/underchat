export class InternalServerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InternalServerError';

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, InternalServerError);
    }
  }
}
