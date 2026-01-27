export class WebhookMappingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookMappingValidationError';

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, WebhookMappingValidationError);
    }
  }
}
